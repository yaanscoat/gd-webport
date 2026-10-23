// Web Audio playback for music (mp3) and sound effects (ogg).
import { BASE } from './assets.js';

let ctx = null, musicGain = null, sfxGain = null;
const buffers = new Map(); // path -> {state, buffer, promise}
let music = null; // {src, gain, startCtx, offset, path}
let volumes = { music: 1, sfx: 1 };

function context() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
    musicGain = ctx.createGain();
    musicGain.gain.value = volumes.music;
    musicGain.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = volumes.sfx;
    sfxGain.connect(ctx.destination);
  }
  return ctx;
}

// Browsers only allow audio after a user gesture.
export function unlockAudio() {
  const c = context();
  if (c.state !== 'running') c.resume();
}

export function load(path) {
  let e = buffers.get(path);
  if (e) return e;
  e = { state: 0, buffer: null };
  e.promise = fetch(BASE + path)
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then((data) => context().decodeAudioData(data))
    .then((buf) => { e.buffer = buf; e.state = 1; })
    .catch((err) => { console.warn('[gd] audio failed:', path, err); e.state = -1; });
  buffers.set(path, e);
  return e;
}

export const musicPath = (file) => `music/${file}`;
export const isReady = (path) => load(path).state === 1;
export const hasFailed = (path) => load(path).state === -1;

export function playMusic(path, offset = 0, loop = false, fadeIn = 0) {
  stopMusic();
  const e = load(path);
  if (e.state !== 1) return false;
  const c = context();
  const src = c.createBufferSource();
  src.buffer = e.buffer;
  src.loop = loop;
  const gain = c.createGain();
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0, c.currentTime);
    gain.gain.linearRampToValueAtTime(1, c.currentTime + fadeIn);
  }
  src.connect(gain).connect(musicGain);
  const off = Math.max(0, loop ? offset % e.buffer.duration : Math.min(offset, e.buffer.duration - 0.01));
  src.start(0, off);
  music = { src, gain, startCtx: c.currentTime, offset: off, path };
  return true;
}

export function stopMusic(fadeOut = 0) {
  if (!music) return;
  const m = music;
  music = null;
  try {
    if (fadeOut > 0) {
      m.gain.gain.setValueAtTime(m.gain.gain.value, ctx.currentTime);
      m.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeOut);
      m.src.stop(ctx.currentTime + fadeOut);
    } else m.src.stop();
  } catch { /* already stopped */ }
}

export function musicTime() {
  return music ? ctx.currentTime - music.startCtx + music.offset : -1;
}

export function currentMusic() { return music ? music.path : null; }

export function sfx(file, volume = 1) {
  const e = load(`sfx/${file}`);
  if (e.state !== 1) return;
  const c = context();
  const src = c.createBufferSource();
  src.buffer = e.buffer;
  const g = c.createGain();
  g.gain.value = volume;
  src.connect(g).connect(sfxGain);
  src.start();
}

export function preloadSfx() {
  for (const f of ['explode_11.ogg', 'playSound_01.ogg', 'quitSound_01.ogg', 'endStart_02.ogg', 'achievement_01.ogg',
    'highscoreGet02.ogg', 'gold02.ogg', 'counter003.ogg']) load(`sfx/${f}`);
}

export function setVolumes(m, s) {
  volumes = { music: m, sfx: s };
  if (musicGain) musicGain.gain.value = m;
  if (sfxGain) sfxGain.gain.value = s;
}
