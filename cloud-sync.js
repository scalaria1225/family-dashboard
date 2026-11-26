/* =========================================================
   우리 가족 학습관리 — 가족 실시간 동기화 (Supabase)
   - 외부 라이브러리 없이 fetch + WebSocket 만 사용
   - 쓰는 법:
       var s = CloudSync.create({
         row: 'main',                 // family_state 테이블의 행 id
         hadLocal: true/false,        // 이 기기에 저장된 기록이 있었는지 (초기값 보호용)
         getState: function(){ return 상태객체; },
         applyState: function(data){ 원격 상태를 화면에 반영; }
       });
       s.init();
       // 상태를 저장할 때마다:  s.onLocalChange();
   - 동작: 열 때 최신 상태 pull → 로컬 저장 + upsert 전송 → Realtime WebSocket 구독
           (끊기면 자동 재연결, 백업으로 탭 포커스/주기적 pull)
   - 초기값 보호: DB 행이 비어 있으면 '이 기기에 저장 기록이 있던' 기기만 자기 데이터를 올린다.
   ========================================================= */
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://xuzeamakhvndgxpynwql.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_OZtBDZ97ar3LgKrlC6v1kw_S--2E1Vk';
  var TABLE = 'family_state';
  var POLL_MS = 15000;          /* 백업 폴링 주기 (탭이 보일 때만) */
  var PUSH_DEBOUNCE_MS = 400;   /* 연속 변경 묶어서 한 번 전송 */
  var RETRY_STEPS = [1000, 2000, 5000, 10000, 20000, 30000];

  function nowISO() { return new Date().toISOString(); }

  function create(opts) {
    var row = String(opts.row || 'main');
    var getState = opts.getState;
    var applyState = opts.applyState || function () {};
    var hadLocal = !!opts.hadLocal;

    var sync = {
      status: 'connecting',
      wsOpen: false,
      wsJoined: false,
      ws: null,
      retry: 0,
      ref: 0,
      retryTimer: null,
      pushTimer: null,
      pollTimer: null,
      heartbeatTimer: null,
      pushing: false,
      dirty: false,          /* 이 기기의 변경을 아직 서버에 못 올림 */
      lastSyncAt: null,
      lastError: null,
      applying: false
    };

    /* ---------- 상태 표시 ---------- */
    function setStatus(s, err) {
      if (sync.status === s && !err) return;
      sync.status = s;
      if (err) sync.lastError = String(err);
      try { if (opts.onStatus) opts.onStatus(sync); } catch (e) {}
    }

    /* ---------- 요청 도우미 ---------- */
    function headers(extra) {
      var h = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY };
      if (extra) { for (var k in extra) h[k] = extra[k]; }
      return h;
    }
    function rowUrl(qs) {
      return SUPABASE_URL + '/rest/v1/' + TABLE + '?id=eq.' + encodeURIComponent(row) + (qs || '');
    }
    function revOf(state) { return state && state._rev ? String(state._rev) : ''; }

    /* ---------- 원격 상태 반영 ---------- */
    function applyRemote(data) {
      if (!data || typeof data !== 'object') return;
      sync.applying = true;
      try { applyState(data); } catch (e) { sync.lastError = String(e && e.message || e); }
      sync.applying = false;
      sync.lastSyncAt = new Date();
      if (sync.status === 'connecting') setStatus(sync.wsJoined ? 'live' : 'connecting');
    }

    /* ---------- 서버 → 이 기기 ---------- */
    function pull() {
      return fetch(rowUrl('&select=data,updated_at'), { headers: headers(), cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        })
        .then(function (rows) {
          if (!rows || !rows.length) {
            /* DB가 비어 있음 → 이 기기에 이미 저장된 자료가 있으면 초기값으로 올린다 */
            if (hadLocal && getState()) { sync.dirty = true; pushNow(); }
            else setStatus(sync.wsJoined ? 'live' : 'connecting');
            return;
          }
          var remote = rows[0] || {};
          var data = remote.data;
          if (!data || typeof data !== 'object') return;
          var local = getState() || {};
          /* 아직 못 올린 이 기기의 변경이 있으면 그쪽이 최신 */
          if (sync.dirty && revOf(local) !== revOf(data)) { pushNow(); return; }
          if (revOf(data) && revOf(data) === revOf(local)) {
            sync.lastSyncAt = remote.updated_at ? new Date(remote.updated_at) : new Date();
            setStatus(sync.wsJoined ? 'live' : 'connecting');
            return;
          }
          applyRemote(data);
          setStatus(sync.wsJoined ? 'live' : 'connecting');
        })
        .catch(function (e) {
          setStatus(global.navigator && global.navigator.onLine === false ? 'offline' : 'error', e && e.message);
        });
    }

    /* ---------- 이 기기 → 서버 ---------- */
    function pushNow() {
      var state = getState();
      if (!state) return;
      if (sync.pushing) { sync.dirty = true; return; }
      var sentRev = revOf(state);
      sync.pushing = true;
      var body = [{ id: row, data: state, updated_at: nowISO() }];
      fetch(SUPABASE_URL + '/rest/v1/' + TABLE, {
        method: 'POST',
        headers: headers({
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        }),
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (rows) {
        sync.pushing = false;
        var saved = rows && rows[0];
        sync.lastSyncAt = (saved && saved.updated_at) ? new Date(saved.updated_at) : new Date();
        /* 전송하는 사이 또 바뀌었으면 한 번 더 */
        if (revOf(getState()) === sentRev) sync.dirty = false;
        else { sync.dirty = true; schedulePush(); }
        if (sync.status === 'offline' || sync.status === 'error') {
          setStatus(sync.wsJoined ? 'live' : 'connecting');
        } else {
          setStatus(sync.wsJoined ? 'live' : 'connecting');
        }
      }).catch(function (e) {
        sync.pushing = false;
        sync.dirty = true;
        setStatus((global.navigator && global.navigator.onLine === false) ? 'offline' : 'error', e && e.message);
        clearTimeout(sync.pushTimer);
        sync.pushTimer = setTimeout(pushNow, 8000);   /* 잠시 뒤 다시 시도 */
      });
    }

    function schedulePush() {
      clearTimeout(sync.pushTimer);
      sync.pushTimer = setTimeout(pushNow, PUSH_DEBOUNCE_MS);
    }

    /* ---------- Realtime WebSocket ---------- */
    function wsUrl() {
      return SUPABASE_URL.replace(/^https:/, 'wss:') +
        '/realtime/v1/websocket?apikey=' + encodeURIComponent(SUPABASE_KEY) + '&vsn=1.0.0';
    }

    function wsSend(msg) {
      if (!sync.ws || sync.ws.readyState !== 1) return;
      msg.ref = String(++sync.ref);
      try { sync.ws.send(JSON.stringify(msg)); } catch (e) {}
    }

    function startHeartbeat() {
      stopHeartbeat();
      sync.heartbeatTimer = setInterval(function () {
        wsSend({ topic: 'phoenix', event: 'heartbeat', payload: {} });
      }, 25000);
    }
    function stopHeartbeat() {
      if (sync.heartbeatTimer) { clearInterval(sync.heartbeatTimer); sync.heartbeatTimer = null; }
    }

    function handleMessage(raw) {
      var msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.event === 'phx_reply' && msg.payload) {
        if (msg.payload.status === 'ok' && msg.topic === 'realtime:' + TABLE) {
          sync.wsJoined = true;
          sync.retry = 0;
          setStatus('live');
          pull();               /* 연결 사이 놓친 변경 따라잡기 */
        } else if (msg.payload.status && msg.payload.status !== 'ok') {
          setStatus('error', 'realtime ' + msg.payload.status);
        }
        return;
      }

      if (msg.event === 'postgres_changes' && msg.payload && msg.payload.data) {
        var rec = msg.payload.data.record || {};
        if (rec.id && rec.id !== row) return;
        var data = rec.data;
        if (!data || typeof data !== 'object') return;
        var local = getState() || {};
        if (revOf(data) && revOf(data) === revOf(local)) return;   /* 내가 올린 것 */
        if (sync.dirty) { pushNow(); return; }                     /* 내 변경이 더 최신 */
        applyRemote(data);
        return;
      }

      if (msg.event === 'phx_error' || msg.event === 'phx_close') {
        setStatus('connecting');
      }
    }

    function scheduleReconnect() {
      clearTimeout(sync.retryTimer);
      var i = Math.min(sync.retry, RETRY_STEPS.length - 1);
      var wait = RETRY_STEPS[i];
      sync.retry++;
      sync.retryTimer = setTimeout(connectWS, wait);
    }

    function connectWS() {
      if (!global.WebSocket) { setStatus('connecting'); startPolling(); return; }
      clearTimeout(sync.retryTimer);
      var ws;
      try { ws = new WebSocket(wsUrl()); } catch (e) { scheduleReconnect(); return; }
      sync.ws = ws;

      ws.onopen = function () {
        sync.wsOpen = true;
        setStatus('connecting');
        startHeartbeat();
        wsSend({
          topic: 'realtime:' + TABLE,
          event: 'phx_join',
          payload: {
            config: {
              broadcast: { self: false },
              presence: { key: row },
              postgres_changes: [{ event: '*', schema: 'public', table: TABLE, filter: 'id=eq.' + row }]
            },
            access_token: SUPABASE_KEY
          }
        });
      };
      ws.onmessage = function (ev) { handleMessage(ev.data); };
      ws.onerror = function () {};
      ws.onclose = function () {
        sync.wsOpen = false;
        sync.wsJoined = false;
        stopHeartbeat();
        setStatus((global.navigator && global.navigator.onLine === false) ? 'offline' : 'connecting');
        scheduleReconnect();
      };
    }

    /* ---------- 백업: 주기적/포커스 시 pull ---------- */
    function startPolling() {
      if (sync.pollTimer) return;
      sync.pollTimer = setInterval(function () {
        if (global.document && global.document.visibilityState === 'hidden') return;
        if (sync.wsJoined) return;      /* 실시간이 붙어 있으면 폴링 생략 */
        pull();
      }, POLL_MS);
    }

    /* ---------- 바깥에서 쓰는 API ---------- */
    sync.init = function () {
      setStatus('connecting');
      pull();
      connectWS();
      startPolling();
      if (global.document) {
        global.document.addEventListener('visibilitychange', function () {
          if (global.document.visibilityState === 'visible') pull();
        });
      }
      global.addEventListener('focus', function () { pull(); });
      global.addEventListener('online', function () {
        setStatus('connecting');
        pull();
        if (!sync.ws || sync.ws.readyState > 1) connectWS();
      });
      global.addEventListener('offline', function () { setStatus('offline'); });
    };

    /* 상태가 저장될 때마다 호출 (원격 적용 중에는 부르지 않는다) */
    sync.onLocalChange = function () {
      if (sync.applying) return;
      sync.dirty = true;
      schedulePush();
    };

    sync.pull = pull;
    sync.pushNow = pushNow;
    sync.applyRemote = applyRemote;
    return sync;
  }

  global.CloudSync = { create: create, url: SUPABASE_URL, table: TABLE };
})(window);
