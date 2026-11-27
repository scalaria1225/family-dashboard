/* MP4 export: realtime MediaRecorder (Safari) → WebCodecs + mp4-muxer (Chrome) → WebM fallback */
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

const W = 1080;
const H = 1920;
const FPS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MP4_TYPES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4d002a,mp4a.40.2',
  'video/mp4;codecs=h264,aac',
  'video/mp4',
];

function pickMp4Type() {
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return null;
  for (const t of MP4_TYPES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* next */ }
  }
  return null;
}

export function capabilities() {
  return {
    mp4Recorder: pickMp4Type(),
    webcodecs: !!(window.VideoEncoder && window.VideoFrame),
    audio: !!(window.AudioEncoder && window.AudioData),
    share: !!(navigator.share && navigator.canShare),
  };
}

export async function exportMovie(api, ui) {
  const total = api.totalDuration();
  if (!total) throw new Error('먼저 사진이나 영상을 추가해 주세요.');
  if (ui.cancelled()) return { cancelled: true };

  const mp4 = pickMp4Type();
  if (mp4) {
    const out = await recordRealtime(api, ui, mp4, total);
    if (out.cancelled) return out;
    return { blob: out.blob, ext: 'mp4', mode: 'realtime-mp4' };
  }

  if (window.VideoEncoder && window.VideoFrame) {
    try {
      const out = await encodeWithWebCodecs(api, ui, total);
      if (out.cancelled) return out;
      if (out.blob && out.blob.size) return { blob: out.blob, ext: 'mp4', mode: 'webcodecs' };
    } catch (e) {
      console.warn('WebCodecs export failed, falling back to MediaRecorder', e);
      if (ui.cancelled()) return { cancelled: true };
    }
  }

  const out = await recordRealtime(api, ui, 'video/webm', total);
  if (out.cancelled) return out;
  return { blob: out.blob, ext: 'webm', mode: 'webm' };
}

/* ------------------------------------------------------------------ */
/* 1) realtime recording (canvas + audio graph)                       */
/* ------------------------------------------------------------------ */
async function recordRealtime(api, ui, mime, total) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  api.seekTo(0);
  await api.prepareFrame(0);
  api.drawFrame(ctx, 0, W, H);

  const stream = canvas.captureStream(30);
  const dest = api.beginExportAudio();
  if (dest) {
    dest.stream.getAudioTracks().forEach((t) => { try { stream.addTrack(t); } catch (e) {} });
  }

  let rec;
  const opts = { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 };
  try { rec = new MediaRecorder(stream, opts); }
  catch (e) {
    try { rec = new MediaRecorder(stream, { videoBitsPerSecond: 8_000_000 }); }
    catch (e2) { rec = new MediaRecorder(stream); }
  }

  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = (e) => reject((e && e.error) || new Error('녹화 오류'));
  });

  rec.start(200);
  await sleep(180);

  ui.progress(0.01, '녹화를 시작했어요…');
  api.play();

  let cancelled = false;
  await new Promise((resolve) => {
    const loop = () => {
      const t = api.getPlayhead();
      try { api.drawFrame(ctx, t, W, H); } catch (e) { /* keep recording */ }
      ui.progress(Math.min(0.98, t / total), `녹화 중 ${t.toFixed(1)} / ${total.toFixed(1)}초`);
      if (ui.cancelled()) { cancelled = true; api.pause(); resolve(); return; }
      if (!api.state.playing) { resolve(); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });

  api.drawFrame(ctx, total, W, H);
  await sleep(260);
  try { rec.stop(); } catch (e) {}
  try { await stopped; } catch (e) { console.warn(e); }
  stream.getTracks().forEach((t) => { try { t.stop(); } catch (e) {} });
  api.endExportAudio();

  if (cancelled || ui.cancelled()) return { cancelled: true };
  const type = mime.split(';')[0] || 'video/mp4';
  return { blob: new Blob(chunks, { type }), mime };
}

/* ------------------------------------------------------------------ */
/* 2) frame accurate WebCodecs encode → MP4                           */
/* ------------------------------------------------------------------ */
async function encodeWithWebCodecs(api, ui, total) {
  const frames = Math.max(1, Math.round(total * FPS));
  const candidates = [
    { codec: 'avc1.640028', bitrate: 9_000_000 },
    { codec: 'avc1.4d0032', bitrate: 8_000_000 },
    { codec: 'avc1.42E01E', bitrate: 6_000_000 },
  ];
  let cfg = null;
  for (const c of candidates) {
    const trial = { codec: c.codec, width: W, height: H, bitrate: c.bitrate, framerate: FPS };
    try {
      const s = await VideoEncoder.isConfigSupported(trial);
      if (s && s.supported) { cfg = trial; break; }
    } catch (e) { /* next */ }
  }
  if (!cfg) throw new Error('이 브라우저에서는 MP4 인코딩을 지원하지 않아요.');

  ui.progress(0.01, '오디오 준비 중…');
  let mix = null;
  if (window.AudioEncoder && window.AudioData) {
    try { mix = await api.renderAudioMix(total); } catch (e) { mix = null; }
  }

  const muxerOpts = {
    target: new ArrayBufferTarget(),
    fastStart: 'in-memory',
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
  };
  if (mix) muxerOpts.audio = { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 };

  let muxer;
  try { muxer = new Muxer(muxerOpts); }
  catch (e) { muxerOpts.audio = undefined; muxer = new Muxer(muxerOpts); }

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { try { muxer.addVideoChunk(chunk, meta); } catch (e) { encodeError = e; } },
    error: (e) => { encodeError = e; },
  });
  encoder.configure({ ...cfg, avc: { format: 'avc' } });

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false });

  for (let i = 0; i < frames; i++) {
    if (ui.cancelled()) { try { encoder.close(); } catch (e) {} return { cancelled: true }; }
    if (encodeError) throw encodeError;
    const t = Math.min(total - 1e-3, i / FPS);
    await api.prepareFrame(t);
    api.drawFrame(ctx, t, W, H);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1e6) / FPS),
      duration: Math.round(1e6 / FPS),
    });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (i % 3 === 0) ui.progress((i / frames) * 0.9, `프레임 ${i + 1} / ${frames}`);
    while (encoder.encodeQueueSize > 6) await sleep(10);
  }
  await encoder.flush();
  try { encoder.close(); } catch (e) {}
  if (encodeError) throw encodeError;

  if (mix) {
    ui.progress(0.94, '오디오 인코딩 중…');
    const aenc = new AudioEncoder({
      output: (chunk, meta) => { try { muxer.addAudioChunk(chunk, meta); } catch (e) { console.warn(e); } },
      error: (e) => console.warn('audio encode error', e),
    });
    aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128_000 });
    const ch0 = mix.getChannelData(0);
    const ch1 = mix.numberOfChannels > 1 ? mix.getChannelData(1) : ch0;
    const block = 4800;
    for (let off = 0; off < mix.length; off += block) {
      const n = Math.min(block, mix.length - off);
      const data = new Float32Array(n * 2);
      data.set(ch0.subarray(off, off + n), 0);
      data.set(ch1.subarray(off, off + n), n);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((off / 48000) * 1e6),
        data,
      });
      aenc.encode(ad);
      ad.close();
      if (aenc.encodeQueueSize > 24) await sleep(6);
    }
    await aenc.flush();
    try { aenc.close(); } catch (e) {}
  }

  ui.progress(0.99, '파일 정리 중…');
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }) };
}
