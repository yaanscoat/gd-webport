// AngelCode BMFont (.fnt text format) renderer for the game's bigFont / goldFont / chatFont.
import { text } from '../core/assets.js';
import { gfx } from './renderer.js';

export class BitmapFont {
  constructor(fntPath) {
    const src = text(fntPath);
    this.glyphs = new Map();
    this.lineHeight = 0;
    const dir = fntPath.slice(0, fntPath.lastIndexOf('/') + 1);
    const attr = (line, key) => {
      const m = line.match(new RegExp(`\\s${key}=(-?[\\d.]+)`));
      return m ? parseFloat(m[1]) : 0;
    };
    for (const line of src.split('\n')) {
      if (line.startsWith('common ')) this.lineHeight = attr(line, 'lineHeight');
      else if (line.startsWith('page ')) this.texPath = dir + line.match(/file="([^"]+)"/)[1];
      else if (line.startsWith('char ')) {
        this.glyphs.set(attr(line, 'id'), {
          x: attr(line, 'x'), y: attr(line, 'y'), w: attr(line, 'width'), h: attr(line, 'height'),
          xo: attr(line, 'xoffset'), yo: attr(line, 'yoffset'), adv: attr(line, 'xadvance'),
        });
      }
    }
    this.tex = gfx.r.texture(this.texPath);
  }

  measure(str, scale = 1) {
    const cs = gfx.r.contentScale;
    let w = 0, maxW = 0, lines = 1;
    for (const ch of str) {
      if (ch === '\n') { maxW = Math.max(maxW, w); w = 0; lines++; continue; }
      const g = this.glyphs.get(ch.codePointAt(0));
      if (g) w += g.adv;
    }
    maxW = Math.max(maxW, w);
    return [(maxW / cs) * scale, ((this.lineHeight * lines) / cs) * scale];
  }

  // Draws text with its anchor (0..1, 0..1) at x,y in points.
  draw(str, x, y, scale, color, ax = 0.5, ay = 0.5) {
    const t = this.tex;
    if (!t.ready) return;
    const r = gfx.r;
    const k = scale / r.contentScale;
    const [w, h] = this.measure(str, scale);
    const startX = x - w * ax;
    let cx = startX, cy = y - h * ay + h;
    const iw = 1 / t.w, ih = 1 / t.h;
    for (const ch of str) {
      if (ch === '\n') { cx = startX; cy -= this.lineHeight * k; continue; }
      const g = this.glyphs.get(ch.codePointAt(0));
      if (!g) continue;
      if (g.w > 0 && g.h > 0) {
        const gx = cx + g.xo * k, gy = cy - g.yo * k, gw = g.w * k, gh = g.h * k;
        r.drawTexQuad(t, gx, gy - gh, gx + gw, gy - gh, gx, gy, gx + gw, gy,
          g.x * iw, (g.y + g.h) * ih, (g.x + g.w) * iw, (g.y + g.h) * ih, g.x * iw, g.y * ih, (g.x + g.w) * iw, g.y * ih, color);
      }
      cx += g.adv * k;
    }
  }
}

export const fonts = { big: null, gold: null, chat: null };

export function loadFonts() {
  fonts.big = new BitmapFont('fonts/bigFont.fnt');
  fonts.gold = new BitmapFont('fonts/goldFont.fnt');
  fonts.chat = new BitmapFont('fonts/chatFont.fnt');
  return [fonts.big.texPath, fonts.gold.texPath, fonts.chat.texPath];
}
