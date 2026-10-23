// Shared visuals for menu scenes: scrolling background and ground like the original menus.
import { Affine, applyHSV, rgb, withAlpha } from '../core/math.js';
import { gfx } from '../gfx/renderer.js';
import { app } from '../ui/ui.js';

export class MenuBackdrop {
  constructor() {
    this.scroll = 0;
    this.hue = 0;
  }
  update(dt) {
    this.scroll += dt * 60 * 5.77 * 0.9;
    this.hue = (this.hue + dt * 12) % 360;
  }
  color() { return applyHSV(rgb(0, 102, 255), { h: this.hue, s: 1, v: 1 }); }
  draw(groundY = 90) {
    const r = gfx.r, W = app.W, H = app.H;
    const c = this.color();
    const bg = r.image('tex/game_bg_01_001.png');
    r.drawRect(0, 0, W, H, c);
    if (bg.tex.ready && bg.w > 0) {
      const s = Math.max(1, H / bg.h), tw = bg.w * s;
      const px = (this.scroll * 0.1) % tw;
      for (let x = -px; x < W; x += tw) r.drawFrame(bg, Affine.make(x, 0, 0, s, s), c, false, 0, 0);
    }
    const g = r.image('tex/groundSquare_01_001.png');
    const gc = applyHSV(c, { h: 0, s: 1, v: 0.75 });
    if (g.tex.ready && g.w > 0) {
      const off = this.scroll % g.w;
      for (let x = -off; x < W; x += g.w) r.drawFrame(g, Affine.translate(x, groundY), gc, false, 0, 1);
    } else r.drawRect(0, 0, W, groundY, gc);
    const line = r.frame('floorLine_001.png');
    if (line) r.drawFrame(line, Affine.make(W / 2, groundY, 0, W / line.sw, 1), withAlpha([1, 1, 1, 1], 1), true, 0.5, 1);
  }
}
