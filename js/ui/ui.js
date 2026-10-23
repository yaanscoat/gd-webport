// Scene management and GD-style UI widgets.
import { Affine, Rect } from '../core/math.js';
import { fonts } from '../gfx/font.js';
import { gfx } from '../gfx/renderer.js';

export const KEY = {
  ENTER: 'Enter', ESC: 'Escape', SPACE: 'Space', LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', DOWN: 'ArrowDown',
  A: 'KeyA', D: 'KeyD', P: 'KeyP', R: 'KeyR', W: 'KeyW', X: 'KeyX', Z: 'KeyZ',
};

export const CREDIT = 'Webported by yaanscoat';
export const CREDIT_URL = 'https://github.com/yaanscoat';

// Global view state. H is always 320 game points; W follows the screen aspect.
export const app = {
  W: 569,
  H: 320,
  scene: null,
  next: null,
  fade: 0,
  fadeDir: 0,
  fadeDur: 0.4,
  canvas: null,
  setScene(makeScene, fade = 0.4) {
    if (fade <= 0 || !this.scene) {
      this.scene = makeScene();
      return;
    }
    this.next = makeScene;
    this.fadeDur = fade / 2;
    this.fadeDir = 1;
  },
  update(dt) {
    if (this.fadeDir === 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      if (this.fade >= 1) {
        this.scene = this.next();
        this.next = null;
        this.fadeDir = -1;
      }
    } else if (this.fadeDir === -1) {
      this.fade = Math.max(0, this.fade - dt / this.fadeDur);
      if (this.fade <= 0) this.fadeDir = 0;
    }
    this.scene?.update(dt);
  },
  draw() {
    this.scene?.draw();
    if (this.fade > 0) gfx.r.drawRect(0, 0, this.W, this.H, [0, 0, 0, this.fade]);
  },
  setCursor(pointer) { if (this.canvas) this.canvas.style.cursor = pointer ? 'pointer' : 'default'; },
};

// GD "MenuItemSpriteExtra": grows while pressed, fires on release inside.
export class Button {
  constructor(opts = {}) {
    this.frame = opts.frame ? gfx.r.frame(opts.frame) : null;
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.scale = opts.scale ?? 1;
    this.pressScale = opts.pressScale ?? 1.26;
    this.color = opts.color ?? [1, 1, 1, 1];
    this.onClick = opts.onClick ?? null;
    this.drawContent = opts.drawContent ?? null; // (affine, alpha) => void
    this.w = opts.w ?? 0;
    this.h = opts.h ?? 0;
    this.visible = true;
    this.enabled = opts.enabled ?? true;
    this.anim = 1;
    this.pressed = false;
  }
  size() {
    if (this.w) return [this.w, this.h];
    return this.frame ? [this.frame.sw, this.frame.sh] : [40, 40];
  }
  hit(px, py) {
    if (!this.visible || !this.enabled) return false;
    const [w, h] = this.size();
    return Rect.centered(this.x, this.y, w * this.scale, h * this.scale).contains(px, py);
  }
  update(dt) {
    const target = this.pressed ? this.pressScale : 1;
    this.anim += (target - this.anim) * Math.min(1, dt * (this.pressed ? 14 : 18));
  }
  draw() {
    if (!this.visible) return;
    const s = this.scale * this.anim;
    const m = Affine.make(this.x, this.y, 0, s, s);
    const c = this.enabled ? this.color : [this.color[0] * 0.5, this.color[1] * 0.5, this.color[2] * 0.5, this.color[3]];
    if (this.frame) gfx.r.drawFrame(this.frame, m, c);
    this.drawContent?.(m, c[3]);
  }
}

export class Menu {
  constructor() { this.buttons = []; this.active = null; }
  add(b) { this.buttons.push(b); return b; }
  clear() { this.buttons = []; this.active = null; }
  event(e) {
    if (e.type === 'down') {
      for (let i = this.buttons.length - 1; i >= 0; i--) {
        const b = this.buttons[i];
        if (b.hit(e.x, e.y)) { this.active = b; b.pressed = true; return true; }
      }
    } else if (e.type === 'move') {
      app.setCursor(this.buttons.some((b) => b.hit(e.x, e.y)));
      if (this.active) { this.active.pressed = this.active.hit(e.x, e.y); return true; }
    } else if (e.type === 'up' && this.active) {
      const b = this.active;
      this.active = null;
      const inside = b.hit(e.x, e.y);
      b.pressed = false;
      if (inside && b.onClick) { app.setCursor(false); b.onClick(); }
      return true;
    }
    return false;
  }
  update(dt) { for (const b of this.buttons) b.update(dt); }
  draw() { for (const b of this.buttons) b.draw(); }
}

// ---------------------------------------------------------------- drawing helpers

export function drawNineSlice(f, x, y, w, h, corner, color) {
  if (!f || !f.tex.ready || f.tw === 0) return;
  const r = gfx.r, fw = f.w, fh = f.h;
  const cu = corner / fw, cv = corner / fh;
  const xs = [x, x + corner, x + w - corner, x + w], ys = [y, y + corner, y + h - corner, y + h];
  const us = [0, cu, 1 - cu, 1], vs = [0, cv, 1 - cv, 1];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cw = xs[i + 1] - xs[i], chh = ys[j + 1] - ys[j];
      if (cw <= 0 || chh <= 0) continue;
      const pw = (us[i + 1] - us[i]) * fw, ph = (vs[j + 1] - vs[j]) * fh;
      const m = Affine.translate(xs[i], ys[j]).mul(Affine.make(0, 0, 0, cw / pw, chh / ph)).mul(Affine.translate(-us[i] * fw, -vs[j] * fh));
      r.drawFramePart(f, m, color, us[i], vs[j], us[i + 1], vs[j + 1]);
    }
  }
}

// GJ_square0N popup background
export function drawBox(cx, cy, w, h, style = 1, alpha = 1) {
  const f = gfx.r.image(`tex/GJ_square0${style}.png`);
  if (!f.tex.ready) { gfx.r.drawRect(cx - w / 2, cy - h / 2, w, h, [0, 0, 0, 0.6 * alpha]); return; }
  drawNineSlice(f, cx - w / 2, cy - h / 2, w, h, 20, [1, 1, 1, alpha]);
}

// GD "ButtonSprite": gold text on a GJ_button_0N background
export function drawTextButton(text, cx, cy, width, scale = 1, bg = 1) {
  const f = gfx.r.image(`tex/GJ_button_0${bg}.png`);
  const w = width * scale, h = 30 * scale;
  drawNineSlice(f, cx - w / 2, cy - h / 2, w, h, 10 * scale, [1, 1, 1, 1]);
  const [tw] = fonts.gold.measure(text, 1);
  const fit = Math.min(0.75 * scale, (w - 14 * scale) / Math.max(1, tw));
  fonts.gold.draw(text, cx, cy + 1.5 * scale, fit, [1, 1, 1, 1]);
}

export function textButton(text, x, y, width, onClick, bg = 1) {
  return new Button({
    x, y, w: width, h: 30, pressScale: 1.15, onClick,
    drawContent: (m) => drawTextButton(text, m.tx, m.ty, width, m.a, bg),
  });
}

export function drawCornerArt() {
  const f = gfx.r.frame('GJ_sideArt_001.png');
  if (!f) return;
  gfx.r.drawFrame(f, Affine.make(0, 0, 0, 1, 1), [1, 1, 1, 1], false, 0, 0);
  gfx.r.drawFrame(f, Affine.make(app.W, 0, 0, -1, 1), [1, 1, 1, 1], false, 0, 0);
}

export function drawGradientBG(color) {
  const f = gfx.r.image('tex/GJ_gradientBG.png');
  if (f.tex.ready && f.w > 0) gfx.r.drawFrame(f, Affine.make(0, 0, 0, app.W / f.w, app.H / f.h), color, false, 0, 0);
  else gfx.r.drawRect(0, 0, app.W, app.H, color);
}

// Credit line shown on menus; clicking it opens the GitHub profile.
export function creditButton(y = 8) {
  return new Button({
    x: app.W / 2, y, w: 230, h: 14, pressScale: 1.08,
    onClick: () => window.open(CREDIT_URL, '_blank', 'noopener'),
    drawContent: (m, a) => fonts.chat.draw(`${CREDIT} - github.com/yaanscoat`, m.tx, m.ty, 0.5 * m.a, [1, 0.9, 0.45, a]),
  });
}
