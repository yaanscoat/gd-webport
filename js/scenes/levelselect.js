// Main level selection: one page per level with difficulty, stars, coins and progress bars.
import { json } from '../core/assets.js';
import * as audio from '../core/audio.js';
import { Affine, applyHSV, clamp, rgb } from '../core/math.js';
import { levelProgress } from '../core/save.js';
import { fonts } from '../gfx/font.js';
import { gfx } from '../gfx/renderer.js';
import { PlayLayer } from '../game/playlayer.js';
import { Button, KEY, Menu, app, creditButton, drawBox, drawCornerArt, drawGradientBG } from '../ui/ui.js';
import { playMenuMusic } from './menu.js';


const DIFF_FACE = ['', 'difficulty_01_btn_001.png', 'difficulty_02_btn_001.png', 'difficulty_03_btn_001.png',
  'difficulty_04_btn_001.png', 'difficulty_05_btn_001.png', 'difficulty_06_btn_001.png'];

export class LevelSelect {
  constructor(focusId = 1) {
    this.wantsMenuMusic = true;
    this.levels = json('levels.json');
    this.page = Math.max(0, this.levels.findIndex((l) => l.id === focusId));
    this.scroll = this.page;
    this.menu = new Menu();
    this.loading = null;
    this.drag = null;
    this.layout();
    playMenuMusic();
  }

  layout() {
    const W = app.W, H = app.H;
    this.menu.clear();
    this.menu.add(new Button({ frame: 'GJ_arrow_01_001.png', x: 26, y: H - 24, scale: 0.8, onClick: () => this.back() }));
    const left = this.menu.add(new Button({ frame: 'navArrowBtn_001.png', x: 28, y: H / 2, scale: 0.8, onClick: () => this.go(-1) }));
    left.drawContent = null;
    left.flip = true;
    this.menu.add(new Button({ frame: 'navArrowBtn_001.png', x: W - 28, y: H / 2, scale: 0.8, onClick: () => this.go(1) }));
    this.levelBtn = this.menu.add(new Button({ x: W / 2, y: H / 2 + 45, w: Math.min(360, W - 120), h: 90, pressScale: 1.08, onClick: () => this.play() }));
    this.menu.add(creditButton(8));
    this.builtFor = W;
  }

  go(d) {
    this.page = (this.page + d + this.levels.length) % this.levels.length;
  }

  back() {
    import('./menu.js').then(({ MainMenu }) => app.setScene(() => new MainMenu()));
  }

  play() {
    if (this.loading) return;
    const info = this.levels[this.page];
    audio.sfx('playSound_01.ogg', 0.7);
    this.loading = { name: info.name, t: 0 };
    this.wantsMenuMusic = false;
    audio.stopMusic(0.4);
    PlayLayer.create(info).then((scene) => app.setScene(() => scene)).catch((err) => {
      console.error(err);
      this.loading = { name: `Failed to load: ${err.message}`, t: 0, failed: true };
      this.wantsMenuMusic = true;
    });
  }

  update(dt) {
    if (this.builtFor !== app.W) this.layout();
    // ease the visible page toward the selected one (wrapping)
    const n = this.levels.length;
    let diff = this.page - this.scroll;
    if (diff > n / 2) diff -= n;
    if (diff < -n / 2) diff += n;
    if (!this.drag) this.scroll += diff * Math.min(1, dt * 10);
    this.scroll = ((this.scroll % n) + n) % n;
    this.menu.update(dt);
    if (this.loading) this.loading.t += dt;
  }

  drawPage(i, offsetX) {
    const r = gfx.r, W = app.W, H = app.H;
    const info = this.levels[i];
    const lp = levelProgress(info.id);
    const cx = W / 2 + offsetX;
    const pressed = Math.abs(offsetX) < 1 ? this.levelBtn.anim : 1;
    const bw = Math.min(360, W - 120) * pressed, bh = 90 * pressed;
    drawBox(cx, H / 2 + 45, bw, bh, 1, 0.75);
    const face = r.frame(DIFF_FACE[info.diff]);
    if (face) r.drawFrame(face, Affine.make(cx - bw / 2 + 42 * pressed, H / 2 + 45, 0, 0.9 * pressed, 0.9 * pressed), [1, 1, 1, 1]);
    const nameScale = Math.min(0.9, (bw - 120) / Math.max(1, fonts.big.measure(info.name, 1)[0])) * pressed;
    fonts.big.draw(info.name, cx + 30 * pressed, H / 2 + 50, nameScale, [1, 1, 1, 1]);
    const star = r.frame('star_small01_001.png');
    fonts.big.draw(String(info.stars), cx + bw / 2 - 30, H / 2 + 22, 0.45, [1, 1, 1, 1], 1, 0.5);
    if (star) r.drawFrame(star, Affine.make(cx + bw / 2 - 20, H / 2 + 22, 0, 1, 1), [1, 1, 1, 1]);
    for (let c = 0; c < 3; c++) {
      const got = (lp.coins >> c) & 1;
      const coin = r.frame(got ? 'GJ_coinsIcon_001.png' : 'GJ_coinsIcon_gray_001.png');
      if (coin) r.drawFrame(coin, Affine.make(cx + 20 + (c - 1) * 22, H / 2 + 20, 0, 0.6, 0.6), [1, 1, 1, got ? 1 : 0.5]);
    }
    if (lp.completed) {
      const done = r.frame('GJ_completesIcon_001.png');
      if (done) r.drawFrame(done, Affine.make(cx + bw / 2 - 18, H / 2 + 72, 0, 0.7, 0.7), [1, 1, 1, 1]);
    }
    const bar = (y, label, pct, color) => {
      fonts.big.draw(label, cx, y + 16, 0.42, [1, 1, 1, 1]);
      const img = r.image('tex/GJ_progressBar_001.png');
      if (img.tex.ready && img.w > 0) {
        const m = Affine.make(cx, y, 0, 0.7, 0.7);
        r.drawFrame(img, m, [0, 0, 0, 0.5]);
        const k = clamp(pct / 100, 0, 1);
        if (k > 0) r.drawFramePart(img, m.mul(Affine.make(0, 0, 0, 0.985, 0.84)).mul(Affine.translate(-img.w / 2, -img.h / 2)), color, 0, 0, k, 1);
      }
      fonts.big.draw(`${pct}%`, cx, y, 0.38, [1, 1, 1, 1]);
    };
    bar(H / 2 - 38, 'Normal Mode', lp.normal, rgb(0, 255, 0));
    bar(H / 2 - 82, 'Practice Mode', lp.practice, rgb(0, 255, 255));
  }

  draw() {
    const r = gfx.r, W = app.W, H = app.H, n = this.levels.length;
    const base = Math.floor(this.scroll), frac = this.scroll - base;
    const ca = this.levels[base % n].color, cb = this.levels[(base + 1) % n].color;
    const col = rgb(ca[0] + (cb[0] - ca[0]) * frac, ca[1] + (cb[1] - ca[1]) * frac, ca[2] + (cb[2] - ca[2]) * frac);
    drawGradientBG(applyHSV(col, { h: 0, s: 1, v: 0.85 }));
    drawCornerArt();
    const pageW = W;
    for (let k = -1; k <= 1; k++) {
      const i = (((base + k) % n) + n) % n;
      const offset = (k - frac) * pageW + (this.drag ? this.drag.dx : 0);
      if (Math.abs(offset) < W) this.drawPage(i, offset);
    }
    for (const b of this.menu.buttons) {
      if (b.flip && b.frame) {
        b.visible = false;
        r.drawFrame(b.frame, Affine.make(b.x, b.y, 0, -b.scale * b.anim, b.scale * b.anim), [1, 1, 1, 1]);
      }
    }
    this.menu.draw();
    for (const b of this.menu.buttons) if (b.flip) b.visible = true;
    // page dots
    const dot = r.frame('uiDot_001.png');
    if (dot) {
      const spacing = Math.min(14, (W - 80) / n);
      for (let i = 0; i < n; i++) {
        const on = i === this.page;
        r.drawFrame(dot, Affine.make(W / 2 + (i - (n - 1) / 2) * spacing, 26, 0, on ? 0.8 : 0.6, on ? 0.8 : 0.6), on ? [1, 1, 1, 1] : [1, 1, 1, 0.4]);
      }
    }
    if (this.loading) {
      r.drawRect(0, 0, W, H, [0, 0, 0, Math.min(0.6, this.loading.t * 3)]);
      const dots = '.'.repeat(1 + (Math.floor(this.loading.t * 3) % 3));
      fonts.big.draw(this.loading.failed ? this.loading.name : `Loading ${this.loading.name}${dots}`, W / 2, H / 2, 0.6, [1, 1, 1, 1]);
      if (this.loading.failed && this.loading.t > 2.5) this.loading = null;
    }
  }

  event(e) {
    if (this.loading && !this.loading.failed) return;
    if (e.type === 'down' && e.y < app.H - 60 && e.y > 50 && !this.menu.buttons.some((b) => b !== this.levelBtn && b.hit(e.x, e.y))) {
      this.drag = { x0: e.x, dx: 0 };
    }
    if (e.type === 'move' && this.drag) {
      this.drag.dx = e.x - this.drag.x0;
      if (Math.abs(this.drag.dx) > 12 && this.menu.active === this.levelBtn) { this.levelBtn.pressed = false; this.menu.active = null; }
    }
    if (e.type === 'up' && this.drag) {
      const dx = this.drag.dx;
      this.drag = null;
      if (Math.abs(dx) > 60) {
        const d = dx < 0 ? 1 : -1;
        this.scroll = (this.scroll - dx / app.W + this.levels.length) % this.levels.length;
        this.go(d);
        return;
      }
    }
    if (this.menu.event(e)) return;
    if (e.type === 'keydown') {
      if (e.code === KEY.LEFT || e.code === KEY.A) this.go(-1);
      else if (e.code === KEY.RIGHT || e.code === KEY.D) this.go(1);
      else if (e.code === KEY.ENTER || e.code === KEY.SPACE) this.play();
      else if (e.code === KEY.ESC) this.back();
    }
  }
}
