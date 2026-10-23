// Main menu: logo, Play / Icon Kit / Creator buttons, menu music.
import * as audio from '../core/audio.js';
import { Affine } from '../core/math.js';
import { paletteColor, save } from '../core/save.js';
import { fonts } from '../gfx/font.js';
import { gfx } from '../gfx/renderer.js';
import { GM, drawIcon } from '../game/player.js';
import { Button, KEY, Menu, app, creditButton } from '../ui/ui.js';
import { MenuBackdrop } from './common.js';

export function playMenuMusic() {
  const path = audio.musicPath('menuLoop.mp3');
  if (audio.currentMusic() === path) return;
  audio.load(path).promise.then(() => {
    if (audio.currentMusic() !== path && app.scene?.wantsMenuMusic) audio.playMusic(path, 0, true, 0.5);
  });
}

export class MainMenu {
  constructor() {
    this.wantsMenuMusic = true;
    this.backdrop = new MenuBackdrop();
    this.menu = new Menu();
    this.toast = 0;
    this.time = 0;
    this.layout();
    playMenuMusic();
  }

  layout() {
    const W = app.W, H = app.H;
    this.menu.clear();
    const cy = H / 2 - 5;
    this.menu.add(new Button({ frame: 'GJ_garageBtn_001.png', x: W / 2 - 110, y: cy, onClick: () => this.go('garage') }));
    this.menu.add(new Button({ frame: 'GJ_playBtn_001.png', x: W / 2, y: cy, onClick: () => this.go('play') }));
    this.menu.add(new Button({ frame: 'GJ_creatorBtn_001.png', x: W / 2 + 110, y: cy, onClick: () => { this.toast = 2.5; } }));
    this.menu.add(creditButton(10));
    this.builtFor = W;
  }

  go(where) {
    audio.sfx('playSound_01.ogg', 0.6);
    if (where === 'play') import('./levelselect.js').then(({ LevelSelect }) => app.setScene(() => new LevelSelect()));
    else import('./garage.js').then(({ Garage }) => app.setScene(() => new Garage()));
  }

  update(dt) {
    if (this.builtFor !== app.W) this.layout();
    this.time += dt;
    this.backdrop.update(dt);
    this.menu.update(dt);
    if (this.toast > 0) this.toast -= dt;
  }

  draw() {
    const r = gfx.r, W = app.W, H = app.H;
    this.backdrop.draw(60);
    // a cube running along the ground, like the menu game
    const t = this.time;
    const runX = ((t * 160) % (W + 120)) - 60;
    const jump = Math.max(0, Math.sin(t * 4.2)) * 30;
    drawIcon(GM.Cube, save.icons[0], Affine.make(runX, 60 + 15 + jump, (t * 439) % 360, 1, 1), paletteColor(save.color1), paletteColor(save.color2), save.glow);

    const logo = r.frame('GJ_logo_001.png');
    if (logo) {
      const s = Math.min(1, (W - 40) / logo.sw) * 0.95;
      r.drawFrame(logo, Affine.make(W / 2, H - 55, 0, s, s), [1, 1, 1, 1]);
    }
    fonts.big.draw('Webport', W / 2 + 150, H - 88, 0.45, [1, 0.9, 0.3, 1]);
    this.menu.draw();
    if (this.toast > 0) {
      const a = Math.min(1, this.toast);
      r.drawRect(W / 2 - 160, 26, 320, 26, [0, 0, 0, 0.6 * a]);
      fonts.chat.draw('The level editor is not part of this webport yet.', W / 2, 39, 0.6, [1, 1, 1, a]);
    }
  }

  event(e) {
    if (this.menu.event(e)) return;
    if (e.type === 'keydown' && (e.code === KEY.ENTER || e.code === KEY.SPACE)) this.go('play');
  }
}
