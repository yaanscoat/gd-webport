// Geometry Dash webport - entry point.
// Webported by yaanscoat (https://github.com/yaanscoat)
import { fetchJSON, json, preloadText } from './core/assets.js';
import * as audio from './core/audio.js';
import { loadSave, save } from './core/save.js';
import { loadFonts } from './gfx/font.js';
import { Renderer, gfx } from './gfx/renderer.js';
import { loadObjectDefs } from './game/objects.js';
import { MainMenu } from './scenes/menu.js';
import { CREDIT, CREDIT_URL, app } from './ui/ui.js';

const canvas = document.getElementById('game');
const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('boot-fill');
const bootStatus = document.getElementById('boot-status');

console.log(`%c${CREDIT} - ${CREDIT_URL}`, 'color:#ffe36b;font-weight:bold');

function status(text, progress) {
  bootStatus.textContent = text;
  if (progress !== undefined) bootFill.style.width = `${Math.round(progress * 100)}%`;
}

// ---------------------------------------------------------------- view sizing
// The game is laid out in points: 320 tall, width following the aspect ratio
// (letterboxed below 4:3 so portrait phones still show the whole playfield).
const view = { px: 0, py: 0, pw: 0, ph: 0, scale: 1 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const ch = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  const aspect = cw / ch;
  app.H = 320;
  app.W = Math.max(320 * (4 / 3), Math.min(320 * aspect, 320 * (21 / 9)));
  const scale = Math.min(cw / app.W, ch / app.H);
  view.pw = Math.round(app.W * scale);
  view.ph = Math.round(app.H * scale);
  view.px = Math.floor((cw - view.pw) / 2);
  view.py = Math.floor((ch - view.ph) / 2);
  view.scale = scale / dpr;
}

function toGame(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const dpr = canvas.width / rect.width;
  const x = ((clientX - rect.left) * dpr - view.px) / (view.pw / app.W);
  const yTop = ((clientY - rect.top) * dpr - (canvas.height - view.py - view.ph)) / (view.ph / app.H);
  return [x, app.H - yTop];
}

// ---------------------------------------------------------------- input
function dispatch(e) { app.scene?.event?.(e); }

const GAME_KEYS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

function setupInput() {
  canvas.addEventListener('pointerdown', (ev) => {
    audio.unlockAudio();
    canvas.focus();
    canvas.setPointerCapture?.(ev.pointerId);
    const [x, y] = toGame(ev.clientX, ev.clientY);
    dispatch({ type: 'down', x, y, button: ev.button });
    ev.preventDefault();
  });
  canvas.addEventListener('pointermove', (ev) => {
    const [x, y] = toGame(ev.clientX, ev.clientY);
    dispatch({ type: 'move', x, y });
  });
  const up = (ev) => {
    const [x, y] = toGame(ev.clientX, ev.clientY);
    dispatch({ type: 'up', x, y, button: ev.button });
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  window.addEventListener('keydown', (ev) => {
    audio.unlockAudio();
    if (GAME_KEYS.has(ev.code)) ev.preventDefault();
    dispatch({ type: 'keydown', code: ev.code, repeat: ev.repeat });
  });
  window.addEventListener('keyup', (ev) => dispatch({ type: 'keyup', code: ev.code }));
  window.addEventListener('blur', () => dispatch({ type: 'blur' }));
  document.addEventListener('visibilitychange', () => { if (document.hidden) dispatch({ type: 'blur' }); });
  window.addEventListener('resize', resize);
}

// ---------------------------------------------------------------- main loop
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  resize();
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
  last = now;
  app.update(dt);
  const r = gfx.r;
  r.begin(canvas.width, canvas.height, view.px, canvas.height - view.py - view.ph, view.pw, view.ph, app.W, app.H);
  app.draw();
  r.flush();
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    status('Starting renderer…', 0.02);
    gfx.r = new Renderer(canvas);
    app.canvas = canvas;
    resize();

    status('Loading game data…', 0.05);
    const manifest = await fetchJSON('manifest.json');
    await preloadText(manifest.text, (done, total) => status(`Loading game data… (${done}/${total})`, 0.05 + 0.45 * (done / total)));
    gfx.r.contentScale = manifest.scale || 2;
    gfx.r.loadAtlas(json('atlas.json'));
    loadObjectDefs(json('objects.json'));
    const fontTextures = loadFonts();

    status('Loading textures…', 0.5);
    const textures = [...manifest.images, ...fontTextures, 'tex/game_bg_01_001.png', 'tex/groundSquare_01_001.png',
      'tex/GJ_gradientBG.png', 'tex/GJ_square01.png', 'tex/GJ_square02.png', 'tex/GJ_button_01.png', 'tex/GJ_progressBar_001.png'];
    let done = 0;
    await Promise.all(textures.map((p) => gfx.r.texture(p).promise.then(() => {
      done++;
      status(`Loading textures… (${done}/${textures.length})`, 0.5 + 0.45 * (done / textures.length));
    })));
    // the player's chosen icons
    loadSave();
    for (const [prefix, i] of [['player', 0], ['ship', 1], ['player_ball', 2], ['bird', 3], ['dart', 4]]) {
      gfx.r.frame(`${prefix}_${String(save.icons[i]).padStart(2, '0')}_001.png`);
    }
    audio.setVolumes(save.musicVolume, save.sfxVolume);
    audio.preloadSfx();

    status('Ready!', 1);
    setupInput();
    app.setScene(() => new MainMenu(), 0);
    requestAnimationFrame(frame);
    bootEl.classList.add('hidden');
    setTimeout(() => bootEl.remove(), 500);
  } catch (err) {
    console.error(err);
    const hint = location.protocol === 'file:'
      ? ' Open it through a web server (see README.md) - browsers block file:// loading.'
      : ' Make sure the assets/ folder was generated (see README.md).';
    status(`Error: ${err.message}.${hint}`);
    bootFill.style.background = '#ff4a4a';
  }
}

// Debug handle for the browser console, e.g. gd.app.scene
window.gd = { app, gfx, save };

boot();
