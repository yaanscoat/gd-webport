// Icon kit: pick icons for every gamemode plus primary/secondary colors and glow.
import { json } from '../core/assets.js';
import { Affine, rgb } from '../core/math.js';
import { paletteColor, paletteSize, save, writeSave } from '../core/save.js';
import { fonts } from '../gfx/font.js';
import { gfx } from '../gfx/renderer.js';
import { GM, drawIcon } from '../game/player.js';
import { Button, KEY, Menu, app, creditButton, drawBox, drawCornerArt, drawGradientBG, textButton } from '../ui/ui.js';
import { playMenuMusic } from './menu.js';

const KINDS = [
  { gm: GM.Cube, label: 'Cube', re: /^player_(\d+)_001\.png$/ },
  { gm: GM.Ship, label: 'Ship', re: /^ship_(\d+)_001\.png$/ },
  { gm: GM.Ball, label: 'Ball', re: /^player_ball_(\d+)_001\.png$/ },
  { gm: GM.Ufo, label: 'UFO', re: /^bird_(\d+)_001\.png$/ },
  { gm: GM.Wave, label: 'Wave', re: /^dart_(\d+)_001\.png$/ },
  { gm: GM.Robot, label: 'Robot', re: /^robot_(\d+)_01_001\.png$/ },
  { gm: GM.Spider, label: 'Spider', re: /^spider_(\d+)_01_001\.png$/ },
  { gm: GM.Swing, label: 'Swing', re: /^swing_(\d+)_001\.png$/ },
];
const PER_PAGE = 24;

let counts = null;
function iconCounts() {
  if (counts) return counts;
  const frames = Object.keys(json('atlas.json').frames);
  counts = KINDS.map((k) => {
    let max = 0;
    for (const f of frames) { const m = f.match(k.re); if (m) max = Math.max(max, +m[1]); }
    return max;
  });
  return counts;
}

export class Garage {
  constructor() {
    this.wantsMenuMusic = true;
    this.kind = 0;
    this.page = 0;
    this.colorTarget = 1;
    this.menu = new Menu();
    this.layout();
    playMenuMusic();
  }

  get count() { return iconCounts()[this.kind]; }
  get pages() { return Math.max(1, Math.ceil(this.count / PER_PAGE)); }

  layout() {
    const W = app.W, H = app.H, m = this.menu;
    m.clear();
    m.add(new Button({ frame: 'GJ_arrow_01_001.png', x: 26, y: H - 24, scale: 0.8, onClick: () => this.back() }));
    const tabW = Math.min(64, (W - 100) / KINDS.length);
    KINDS.forEach((k, i) => {
      m.add(new Button({
        x: W / 2 + (i - (KINDS.length - 1) / 2) * tabW, y: H - 112, w: tabW - 4, h: 30, pressScale: 1.1,
        onClick: () => { this.kind = i; this.page = Math.floor((save.icons[i] - 1) / PER_PAGE); },
        drawContent: (mm, a) => {
          const on = this.kind === i;
          drawIcon(k.gm, save.icons[i], Affine.make(mm.tx, mm.ty, 0, 0.55 * mm.a, 0.55 * mm.a), on ? paletteColor(save.color1) : [0.5, 0.5, 0.5, 1], on ? paletteColor(save.color2) : [0.7, 0.7, 0.7, 1], false, a, 'idle');
        },
      }));
    });
    // icon grid
    const cols = 12, cell = Math.min(34, (W - 110) / cols);
    for (let i = 0; i < PER_PAGE; i++) {
      const cx = W / 2 + ((i % cols) - (cols - 1) / 2) * cell, cy = H - 150 - Math.floor(i / cols) * cell;
      m.add(new Button({
        x: cx, y: cy, w: cell - 2, h: cell - 2, pressScale: 1.15,
        onClick: () => { const id = this.page * PER_PAGE + i + 1; if (id <= this.count) { save.icons[this.kind] = id; writeSave(); } },
        drawContent: (mm, a) => {
          const id = this.page * PER_PAGE + i + 1;
          if (id > this.count) return;
          const sel = save.icons[this.kind] === id;
          if (sel) gfx.r.drawRect(mm.tx - cell / 2 + 1, mm.ty - cell / 2 + 1, cell - 2, cell - 2, [1, 1, 1, 0.25]);
          const s = (cell / 40) * mm.a * (KINDS[this.kind].gm === GM.Cube ? 0.95 : 0.7);
          drawIcon(KINDS[this.kind].gm, id, Affine.make(mm.tx, mm.ty, 0, s, s), [0.75, 0.75, 0.75, 1], [1, 1, 1, 1], false, a, 'idle');
        },
      }));
    }
    m.add(new Button({ frame: 'navArrowBtn_001.png', x: W - 30, y: H - 167, scale: 0.55, onClick: () => { this.page = (this.page + 1) % this.pages; } }));
    // color palette
    const pc = paletteSize, perRow = Math.ceil(pc / 2), sw = Math.min(20, (W - 60) / perRow);
    for (let i = 0; i < pc; i++) {
      const cx = W / 2 + ((i % perRow) - (perRow - 1) / 2) * sw, cy = 86 - Math.floor(i / perRow) * sw;
      m.add(new Button({
        x: cx, y: cy, w: sw - 2, h: sw - 2, pressScale: 1.2,
        onClick: () => { if (this.colorTarget === 1) save.color1 = i; else save.color2 = i; writeSave(); },
        drawContent: (mm) => {
          const sel = (this.colorTarget === 1 ? save.color1 : save.color2) === i;
          const s = (sw - 4) * mm.a;
          if (sel) gfx.r.drawRect(mm.tx - s / 2 - 2, mm.ty - s / 2 - 2, s + 4, s + 4, [1, 1, 1, 1]);
          gfx.r.drawRect(mm.tx - s / 2, mm.ty - s / 2, s, s, paletteColor(i));
        },
      }));
    }
    m.add(textButton('Col 1', W / 2 - 120, 120, 70, () => { this.colorTarget = 1; }, 1));
    m.add(textButton('Col 2', W / 2 - 40, 120, 70, () => { this.colorTarget = 2; }, 1));
    m.add(textButton('Glow', W / 2 + 40, 120, 70, () => { save.glow = !save.glow; writeSave(); }, 1));
    m.add(creditButton(8));
    this.builtFor = W;
  }

  back() {
    import('./menu.js').then(({ MainMenu }) => app.setScene(() => new MainMenu()));
  }

  update(dt) {
    if (this.builtFor !== app.W) this.layout();
    this.menu.update(dt);
    this.t = (this.t || 0) + dt;
  }

  draw() {
    const W = app.W, H = app.H;
    drawGradientBG(rgb(160, 160, 160));
    drawCornerArt();
    drawBox(W / 2, H - 165, Math.min(W - 60, 470), 104, 2, 0.6);
    drawBox(W / 2, 92, Math.min(W - 40, 500), 74, 2, 0.6);
    const k = KINDS[this.kind];
    drawIcon(k.gm, save.icons[this.kind], Affine.make(W / 2, H - 60, 0, 1.6, 1.6), paletteColor(save.color1), paletteColor(save.color2), save.glow, 1, 'idle', this.t);
    fonts.gold.draw('Icon Kit', W / 2, H - 22, 0.8, [1, 1, 1, 1]);
    fonts.big.draw(`${this.page + 1}/${this.pages}`, W - 30, H - 140, 0.35, [1, 1, 1, 1]);
    fonts.chat.draw(this.colorTarget === 1 ? 'Editing primary color' : 'Editing secondary color', W / 2 + 160, 120, 0.5, [1, 1, 1, 0.8]);
    fonts.chat.draw(save.glow ? 'Glow: on' : 'Glow: off', W / 2 + 160, 108, 0.5, [1, 1, 1, 0.8]);
    this.menu.draw();
  }

  event(e) {
    if (this.menu.event(e)) return;
    if (e.type === 'keydown' && e.code === KEY.ESC) this.back();
  }
}
