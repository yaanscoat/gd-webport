// Gameplay: level objects, collisions, portals/pads/orbs, triggers, color channels, camera, practice mode.
import { fetchText } from '../core/assets.js';
import * as audio from '../core/audio.js';
import { Affine, Rect, applyHSV, clamp, ease, lerp, lerpColor, parseHSV, rgb, withAlpha } from '../core/math.js';
import { levelProgress, paletteColor, save, writeSave } from '../core/save.js';
import { fonts } from '../gfx/font.js';
import { gfx } from '../gfx/renderer.js';
import { Button, CREDIT, KEY, Menu, app, drawBox } from '../ui/ui.js';
import { parseLevel } from './level.js';
import { OT, SLOT, objectDef } from './objects.js';
import { ParticleSystem } from './particles.js';
import { GM, JUMP, Player } from './player.js';

const SECTION = 100;
const PLAYER_LAYER = 4; // drawn between B1 (3) and T1 (5)
const NCH = 1013;
const HIDDEN = 1, ACTIVATED = 2;

const TRIGGER_IDS = new Set([29, 30, 32, 33, 104, 105, 221, 717, 718, 743, 744, 899, 900, 915, 901, 1006, 1007, 1049,
  1268, 1346, 1347, 1520, 1585, 1595, 1611, 1612, 1613, 1616, 1811, 1812, 1814, 1815, 1817, 1818, 1819, 22, 23, 24, 25,
  26, 27, 28, 55, 56, 57, 58, 59, 1912, 1913, 1914, 1916, 1917, 1931, 1932, 1934, 1935, 2015, 2016, 2062, 2067, 2068,
  2701, 2702]);

const COLOR_TRIGGER = { 29: 1000, 30: 1001, 104: 1002, 105: 1004, 221: 1, 717: 2, 718: 3, 743: 4, 744: 1003, 900: 1009, 915: 1002 };
const LEGACY_COLOR = { 1: 1005, 2: 1006, 3: 1, 4: 2, 5: 1007, 6: 3, 7: 4, 8: 1003 };
const SPEED_PORTAL = { 200: 1, 201: 0, 202: 2, 203: 3, 1334: 4 };

const num = (v, d = 0) => (v === undefined || v === '' ? d : parseFloat(v) || 0);
const int = (v, d = 0) => (v === undefined || v === '' ? d : parseInt(v, 10) || 0);

function newChannel() {
  return { color: [1, 1, 1, 1], blending: false, player: 0, copyFrom: 0, hsv: null, tween: null };
}

export class PlayLayer {
  // Loads level data + music, then resolves with a ready scene.
  static async create(info, practice = false) {
    const raw = await fetchText(`levels/${info.id}.txt`);
    const level = await parseLevel(raw);
    const pl = new PlayLayer(info, level, practice);
    const song = audio.musicPath(practice ? 'StayInsideMe.mp3' : info.song);
    await audio.load(song).promise;
    return pl;
  }

  constructor(info, level, practice) {
    this.info = info;
    this.level = level;
    this.practice = practice;
    this.attempt = 1;
    this.checkpoints = [];
    this.circles = [];
    this.bursts = [];
    this.paused = false;
    this.completed = false;
    this.showEnd = false;
    this.deathTimer = -1;
    this.keyHeld = false;
    this.pointerHeld = false;
    this.newBestTimer = -1;
    this.playTime = 0;
    this.pauseMenu = new Menu();
    this.endMenu = new Menu();
    this.pauseBtn = new Button({ frame: 'GJ_pauseBtn_001.png', scale: 0.6, color: [1, 1, 1, 0.5], onClick: () => this.togglePause() });

    const style = {
      ids: save.icons.slice(),
      c1: paletteColor(save.color1),
      c2: paletteColor(save.color2),
      glow: save.glow,
    };
    this.p1 = new Player(style);
    this.p2 = new Player({ ...style, c1: style.c2, c2: style.c1 });
    this.load();
    this.reset(false);
  }

  get song() { return audio.musicPath(this.practice ? 'StayInsideMe.mp3' : this.info.song); }

  // ---------------------------------------------------------------- setup
  load() {
    const st = this.level.settings;
    const objs = [];
    const dynamicGroups = new Set();
    let maxX = 0, maxExtent = 60;
    for (const raw of this.level.objects) {
      const id = int(raw[1]);
      const def = objectDef(id);
      const isTrigger = TRIGGER_IDS.has(id);
      if ((!def && !isTrigger) || id === 31) continue;
      const o = {
        id, def, raw, isTrigger,
        x: num(raw[2]), y: num(raw[3]),
        flipX: raw[4] === '1', flipY: raw[5] === '1', rot: num(raw[6]),
        scaleX: num(raw[128] ?? raw[32], 1), scaleY: num(raw[129] ?? raw[32], 1),
        touch: raw[11] === '1', spawn: raw[62] === '1', multi: raw[87] === '1',
        groups: raw[57] ? raw[57].split('.').map(Number).filter((g) => g > 0) : [],
        zLayer: def ? def.zLayer : 5, zOrder: def ? def.zOrder : 0,
        ch1: def ? def.c1 : 0, ch2: def ? def.c2 : 0,
        dynamic: false, solid: false, hazard: false, interactive: false, extent: 30,
      };
      if (def) {
        if (!def.hasBase && !o.ch1) o.ch1 = o.ch2;
        if (int(raw[21]) > 0) o.ch1 = int(raw[21]);
        if (int(raw[22]) > 0) o.ch2 = int(raw[22]);
        if (raw[21] === undefined && raw[22] === undefined && LEGACY_COLOR[int(raw[19])]) {
          const lc = LEGACY_COLOR[int(raw[19])];
          if (!def.hasBase) o.ch1 = o.ch2 = lc;
          else o.ch1 = lc;
        }
        if (int(raw[24]) !== 0) o.zLayer = int(raw[24]);
        if (raw[25] !== undefined) o.zOrder = int(raw[25]);
        const t = def.type;
        o.solid = t === OT.Solid;
        o.hazard = t === OT.Hazard;
        o.interactive = ![OT.Decoration, OT.Solid, OT.Hazard, OT.Slope, OT.Special].includes(t);
        o.extent = def.extent * Math.max(Math.abs(o.scaleX), Math.abs(o.scaleY)) * 1.42;
        maxExtent = Math.max(maxExtent, Math.min(o.extent, 600));
        if (!isTrigger) maxX = Math.max(maxX, o.x);
      }
      if (isTrigger && (id === 901 || id === 1346 || id === 1347)) {
        dynamicGroups.add(int(raw[51]));
        if (id === 1346) dynamicGroups.add(int(raw[71]));
      }
      o.index = objs.length;
      objs.push(o);
    }
    this.objects = objs;
    this.maxExtent = maxExtent;
    this.levelEnd = Math.max(maxX + 340, 600);
    const nsec = Math.floor(this.levelEnd / SECTION) + 4;
    this.sections = Array.from({ length: nsec }, () => []);
    this.dynamic = [];
    this.triggers = [];
    this.groups = new Map();
    this.coinOrder = [];
    for (const o of objs) {
      for (const g of o.groups) {
        if (!this.groups.has(g)) this.groups.set(g, []);
        this.groups.get(g).push(o.index);
        if (dynamicGroups.has(g)) o.dynamic = true;
      }
      o.sortKey = (o.zLayer + 64) * 1e10 + (o.zOrder + 30000) * 1e5 + o.index;
      if (o.isTrigger) {
        if (!o.spawn && !o.touch) this.triggers.push(o.index);
        continue;
      }
      if (o.def.type === OT.SecretCoin || o.def.type === OT.UserCoin) this.coinOrder.push(o.index);
      if (o.dynamic) this.dynamic.push(o.index);
      else this.sections[clamp(Math.floor(o.x / SECTION), 0, nsec - 1)].push(o.index);
    }
    this.triggers.sort((a, b) => objs[a].x - objs[b].x);
    this.coinOrder.sort((a, b) => objs[a].x - objs[b].x);

    // initial color channels
    const channels = Array.from({ length: NCH }, newChannel);
    channels[1000].color = rgb(40, 125, 255);
    channels[1001].color = rgb(0, 102, 255);
    channels[1009].color = null;
    channels[1002].blending = true;
    for (const c of st.colors) {
      if (c.channel <= 0 || c.channel >= NCH) continue;
      Object.assign(channels[c.channel], { color: c.color, player: c.player, blending: c.blending, copyFrom: c.copyFrom, hsv: c.hsv ?? null });
    }
    if (!channels[1009].color) channels[1009].color = channels[1001].color.slice();
    this.startChannels = channels;
  }

  // Fresh world state (everything that changes during an attempt)
  freshWorld() {
    const n = this.objects.length;
    return {
      offX: new Float32Array(n), offY: new Float32Array(n), extraRot: new Float32Array(n), flags: new Uint8Array(n),
      channels: this.startChannels.map((c) => ({ ...c, color: c.color.slice() })),
      groupAlpha: new Map(), groupOff: new Map(),
      moves: [], rots: [], alphas: [], pulses: [], spawns: [], follows: [],
      nextTrigger: 0, time: 0, camX: 0, camY: -90,
      bounded: false, floorY: 0, ceilY: 0, floorVis: 0, ceilVis: 2000,
      mirrored: false, mirrorT: 0, shake: 0, shakeTime: 0, coins: 0, dual: false,
      p1: null, p2: null,
    };
  }

  cloneWorld(w) {
    const c = { ...w };
    c.offX = w.offX.slice(); c.offY = w.offY.slice(); c.extraRot = w.extraRot.slice(); c.flags = w.flags.slice();
    c.channels = w.channels.map((ch) => ({ ...ch, color: ch.color.slice(), tween: ch.tween ? { ...ch.tween } : null }));
    c.groupAlpha = new Map(w.groupAlpha);
    c.groupOff = new Map(w.groupOff);
    for (const k of ['moves', 'rots', 'alphas', 'pulses', 'spawns', 'follows']) c[k] = w[k].map((a) => ({ ...a }));
    c.p1 = this.p1.snapshot();
    c.p2 = this.p2.snapshot();
    return c;
  }

  reset(fromCheckpoint) {
    const st = this.level.settings;
    if (fromCheckpoint && this.checkpoints.length) {
      const cp = this.checkpoints[this.checkpoints.length - 1];
      this.w = this.cloneWorld(cp);
      this.p1.restore(cp.p1);
      this.p2.restore(cp.p2);
    } else {
      this.w = this.freshWorld();
      this.p1.reset(0, 15, clamp(st.gamemode, 0, 7), st.mini, st.flipGravity, clamp(st.speed, 0, 4));
      if (st.gamemode !== GM.Cube && st.gamemode !== GM.Robot) this.setBounds(this.p1, 165);
      this.w.dual = st.dual;
      if (st.dual) this.startDual(165);
      this.playTime = 0;
    }
    if (this.keyHeld || this.pointerHeld) this.p1.press();
    this.deathTimer = -1;
    this.circles = [];
    this.bursts = [];
    this.completed = false;
    this.showEnd = false;
    this.autoCheckpoint = 0;
    this.newBestTimer = -1;
    this.jumpsAtStart = this.p1.jumps;
    this.updateCamera(0, true);
    this.resolveColors();
    audio.stopMusic();
    this.musicStarted = false;
    this.startMusic();
  }

  startMusic() {
    if (!audio.isReady(this.song)) return;
    const st = this.level.settings;
    audio.playMusic(this.song, this.practice ? 0 : st.songOffset + this.w.time, this.practice, st.fadeIn && this.w.time === 0 ? 1 : 0);
    this.musicStarted = true;
  }

  startDual(portalY) {
    this.w.dual = true;
    this.p2.restore(this.p1.snapshot());
    this.p2.flipGravity(!this.p1.flipped);
    this.p2.holding = this.p1.holding;
    this.setBounds(this.p1, portalY);
  }

  setBounds(p, portalY) {
    const h = p.mode === GM.Ball || p.mode === GM.Spider ? 240 : 300;
    const bottom = Math.max(0, Math.floor((portalY - h / 2) / 30) * 30);
    this.w.bounded = true;
    this.w.floorY = bottom;
    this.w.ceilY = bottom + h;
  }

  // ---------------------------------------------------------------- queries
  objX(o) { return o.x + this.w.offX[o.index]; }
  objY(o) { return o.y + this.w.offY[o.index]; }

  isOff(o) {
    if (this.w.flags[o.index] & HIDDEN) return true;
    for (const g of o.groups) if (this.w.groupOff.get(g)) return true;
    return false;
  }

  groupAlpha(o) {
    let a = 1;
    for (const g of o.groups) { const v = this.w.groupAlpha.get(g); if (v !== undefined) a *= v; }
    return a;
  }

  forEachNear(x0, x1, fn) {
    const a = Math.max(0, Math.floor((x0 - this.maxExtent) / SECTION));
    const b = Math.min(this.sections.length - 1, Math.floor((x1 + this.maxExtent) / SECTION));
    for (let s = a; s <= b; s++) for (const i of this.sections[s]) fn(this.objects[i]);
    for (const i of this.dynamic) fn(this.objects[i]);
  }

  hitbox(o) {
    const cx = this.objX(o), cy = this.objY(o);
    let w = 30, h = 30, x = -15, y = -15;
    if (o.def.hitbox) [w, h, x, y] = o.def.hitbox;
    else if (!o.solid && o.def.parts.length) {
      const f = o.def.parts[0].frame;
      w = f.sw; h = f.sh; x = -w / 2; y = -h / 2;
    }
    const m = Affine.make(0, 0, o.rot + this.w.extraRot[o.index], o.scaleX * (o.flipX ? -1 : 1), o.scaleY * (o.flipY ? -1 : 1));
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      const tx = m.applyX(px, py), ty = m.applyY(px, py);
      if (tx < minx) minx = tx; if (tx > maxx) maxx = tx;
      if (ty < miny) miny = ty; if (ty > maxy) maxy = ty;
    }
    return new Rect(cx + minx, cy + miny, maxx - minx, maxy - miny);
  }

  get percent() { return clamp((this.p1.x / this.levelEnd) * 100, 0, 100); }

  // ---------------------------------------------------------------- simulation
  physics(frames) {
    const sub = Math.max(1, Math.ceil(frames * 4));
    const sd = frames / sub;
    for (let i = 0; i < sub; i++) {
      const p1 = this.p1;
      if (p1.dead || this.completed) break;
      p1.step(sd);
      this.collide(p1);
      if (p1.spiderJump) this.spiderTeleport(p1);
      if (this.w.dual && !p1.dead) {
        const p2 = this.p2;
        p2.holding = p1.holding;
        if (p1.justPressed || p1.pressBuffered) { p2.justPressed ||= p1.justPressed; p2.pressBuffered ||= p1.pressBuffered; }
        p2.step(sd);
        p2.x = p1.x;
        this.collide(p2);
        if (p2.spiderJump) this.spiderTeleport(p2);
      }
      if (p1.x >= this.levelEnd && !p1.dead) this.complete();
    }
  }

  collide(p) {
    if (p.dead) return;
    const w = this.w;
    p.onGround = false;
    p.onCeiling = false;
    const half = p.outer().h / 2;

    const floorY = w.bounded ? w.floorY : 0;
    if (p.y - half <= floorY) {
      p.y = floorY + half;
      if (!p.flipped) p.hitGround(); else if (p.yVel < 0) p.hitCeiling();
    }
    if (w.bounded && p.y + half >= w.ceilY) {
      p.y = w.ceilY - half;
      if (p.flipped) p.hitGround(); else if (p.yVel > 0) p.hitCeiling();
    }
    if (!w.bounded && p.y > 2400) { this.kill(p); return; }

    const outer = p.outer();
    const tol = p.mode === GM.Ship || p.mode === GM.Ufo ? 6 : 10;
    let died = false;
    this.forEachNear(outer.minX - 30, outer.maxX + 30, (o) => {
      if (died || p.dead || o.isTrigger || !(o.solid || o.hazard || o.interactive)) return;
      if (this.isOff(o)) return;
      const cx = this.objX(o), cy = this.objY(o);
      if (Math.abs(cx - p.x) > o.extent + 40) return;

      if (o.hazard && o.def.radius > 0) {
        const rad = o.def.radius * Math.max(Math.abs(o.scaleX), Math.abs(o.scaleY));
        const po = p.outer();
        const nx = clamp(cx, po.minX, po.maxX), ny = clamp(cy, po.minY, po.maxY);
        if ((cx - nx) ** 2 + (cy - ny) ** 2 < rad * rad) died = true;
        return;
      }
      const r = this.hitbox(o);
      const po = p.outer();
      if (!po.intersects(r)) return;

      if (o.solid) {
        const flyer = p.isFlyer;
        if (!p.flipped) {
          if (p.yVel <= 0 && po.minY >= r.maxY - tol) { p.y = r.maxY + half; p.hitGround(); return; }
          if (flyer && p.yVel >= 0 && po.maxY <= r.minY + tol) { p.y = r.minY - half; p.hitCeiling(); return; }
        } else {
          if (p.yVel >= 0 && po.maxY <= r.minY + tol) { p.y = r.minY - half; p.hitGround(); return; }
          if (flyer && p.yVel <= 0 && po.minY >= r.maxY - tol) { p.y = r.maxY + half; p.hitCeiling(); return; }
        }
        if (p.inner().intersects(r)) died = true;
      } else if (o.hazard) {
        died = true;
      } else if (!(w.flags[o.index] & ACTIVATED) || o.multi) {
        this.activate(p, o, cx, cy);
      }
    });
    if (died) this.kill(p);
  }

  spiderTeleport(p) {
    p.spiderJump = false;
    const fl = p.flip, o = p.outer(), w = this.w;
    let best = fl > 0 ? (w.bounded ? w.ceilY : 2000) : (w.bounded ? w.floorY : 0);
    this.forEachNear(o.minX, o.maxX, (ob) => {
      if (!ob.solid || this.isOff(ob)) return;
      const r = this.hitbox(ob);
      if (r.maxX <= o.minX || r.minX >= o.maxX) return;
      if (fl > 0 && r.minY >= o.maxY - 1 && r.minY < best) best = r.minY;
      if (fl < 0 && r.maxY <= o.minY + 1 && r.maxY > best) best = r.maxY;
    });
    const fromY = p.y, half = o.h / 2;
    p.y = fl > 0 ? best - half : best + half;
    p.flipGravity(!p.flipped, false);
    p.hitGround();
    this.circles.push({ x: p.x, y: (fromY + p.y) / 2, t: 0, dur: 0.25, r0: 4, r1: 4, c: withAlpha(p.style.c1, 0.8), filled: true });
  }

  activate(p, o, cx, cy) {
    const w = this.w;
    const t = o.def.type;
    const fx = (c, r1 = 55, dur = 0.35) => this.circles.push({ x: cx, y: cy, t: 0, dur, r0: 5, r1, c: withAlpha(c, 0.9), filled: false });
    const done = () => { w.flags[o.index] |= ACTIVATED; };
    const setMode = (m, bounded) => {
      p.setGamemode(m);
      if (bounded || w.dual) this.setBounds(p, cy); else w.bounded = false;
      if (w.dual && p === this.p1) this.p2.setGamemode(m);
    };
    switch (t) {
      case OT.GravityUpPortal:
      case OT.GravityDownPortal: {
        const flip = t === OT.GravityUpPortal;
        if (p.flipped !== flip) { p.flipGravity(flip); fx(flip ? rgb(255, 255, 0) : rgb(0, 200, 255)); }
        done();
        break;
      }
      case OT.ShipPortal: setMode(GM.Ship, true); fx(rgb(255, 0, 255)); done(); break;
      case OT.CubePortal: setMode(GM.Cube, false); fx(rgb(0, 255, 0)); done(); break;
      case OT.BallPortal: setMode(GM.Ball, true); fx(rgb(255, 80, 0)); done(); break;
      case OT.UfoPortal: setMode(GM.Ufo, true); fx(rgb(255, 150, 0)); done(); break;
      case OT.WavePortal: setMode(GM.Wave, true); fx(rgb(0, 150, 255)); done(); break;
      case OT.RobotPortal: setMode(GM.Robot, false); fx([1, 1, 1, 1]); done(); break;
      case OT.SpiderPortal: setMode(GM.Spider, true); fx(rgb(150, 0, 255)); done(); break;
      case OT.MiniPortal:
      case OT.NormalSizePortal:
        p.mini = t === OT.MiniPortal;
        if (w.dual) this.p2.mini = p.mini;
        fx(p.mini ? rgb(255, 0, 200) : rgb(0, 255, 100));
        done();
        break;
      case OT.MirrorPortal:
      case OT.UnmirrorPortal:
        w.mirrored = t === OT.MirrorPortal;
        fx(rgb(255, 150, 0));
        done();
        break;
      case OT.DualPortal:
        if (!w.dual) this.startDual(cy);
        fx(rgb(255, 150, 0));
        done();
        break;
      case OT.SoloPortal:
        if (w.dual) {
          w.dual = false;
          if (this.p1.mode === GM.Cube || this.p1.mode === GM.Robot) w.bounded = false;
        }
        fx(rgb(0, 200, 255));
        done();
        break;
      case OT.TeleportPortal:
        p.y += num(o.raw[54], 100);
        fx(rgb(255, 150, 0));
        done();
        break;
      case OT.Modifier:
        if (SPEED_PORTAL[o.id] !== undefined) {
          p.speed = SPEED_PORTAL[o.id];
          if (w.dual) this.p2.speed = p.speed;
        }
        done();
        break;
      case OT.YellowPad:
      case OT.PinkPad:
      case OT.RedPad:
      case OT.GravityPad: {
        done();
        let mult = p.mini ? 0.8 : 1;
        if (p.mode === GM.Ball || p.mode === GM.Spider) mult *= 0.6;
        if (p.isFlyer) mult *= 0.5;
        if (t === OT.GravityPad) {
          p.flipGravity(!p.flipped, false);
          p.yVel = -p.flip * JUMP * 0.8 * (p.mini ? 0.8 : 1);
        } else {
          const v = t === OT.YellowPad ? 16 : t === OT.PinkPad ? 10.4 : 20;
          p.yVel = p.flip * v * mult;
        }
        p.onGround = false;
        fx(t === OT.YellowPad ? rgb(255, 255, 0) : t === OT.PinkPad ? rgb(255, 0, 255) : t === OT.RedPad ? rgb(255, 50, 50) : rgb(0, 255, 255), 30, 0.25);
        break;
      }
      case OT.YellowRing: case OT.PinkRing: case OT.RedRing: case OT.GravityRing: case OT.GreenRing:
      case OT.DropRing: case OT.DashRing: case OT.GravityDashRing: case OT.CustomRing: {
        if (!p.pressBuffered || !p.holding) break;
        if (p.mode === GM.Wave && t !== OT.GravityRing && t !== OT.GreenRing) break;
        done();
        p.pressBuffered = false;
        p.justPressed = false;
        let v = JUMP;
        let col = rgb(255, 255, 0);
        switch (t) {
          case OT.PinkRing:
            col = rgb(255, 0, 255);
            v *= p.mode === GM.Ship ? 0.37 : p.mode === GM.Ufo ? 0.42 : p.mode === GM.Ball ? 0.77 : 0.72;
            break;
          case OT.RedRing:
            col = rgb(255, 50, 50);
            v *= p.mode === GM.Robot ? 1.28 : p.mode === GM.Ball || p.mode === GM.Spider ? 1.34 : p.mode === GM.Ufo ? 1.02 : 1.38;
            break;
          case OT.GravityRing: col = rgb(0, 255, 255); v *= 0.8; break;
          case OT.GreenRing:
            col = rgb(0, 255, 0);
            p.flipGravity(!p.flipped);
            if (p.mode === GM.Ship) v *= 0.7;
            break;
          case OT.DropRing: col = [0.2, 0.2, 0.2, 1]; break;
          default: if (p.mode === GM.Robot) v *= 0.9;
        }
        if (t === OT.DropRing) {
          const dv = p.mode === GM.Ufo ? 11.2 : p.mode === GM.Ship || p.mode === GM.Wave ? 14 : p.mode === GM.Spider ? 16.5 : 15;
          p.yVel = -dv * p.flip;
        } else if (p.mode !== GM.Wave) {
          v *= p.mini ? 0.8 : 1;
          if (p.mode === GM.Ball || p.mode === GM.Spider) v *= 0.7;
          p.yVel = v * p.flip;
        }
        if (t === OT.GravityRing) p.flipGravity(!p.flipped);
        p.onGround = false;
        p.jumps++;
        fx(col, 45, 0.3);
        break;
      }
      case OT.SecretCoin:
      case OT.UserCoin: {
        w.flags[o.index] |= ACTIVATED | HIDDEN;
        const i = this.coinOrder.indexOf(o.index);
        if (i >= 0) w.coins |= 1 << i;
        audio.sfx('gold02.ogg', 0.7);
        fx(rgb(255, 230, 100), 50, 0.4);
        break;
      }
      case OT.Collectible: w.flags[o.index] |= ACTIVATED | HIDDEN; break;
    }
  }

  kill(p) {
    if (p.dead || this.completed || this.noclip) return;
    this.p1.dead = true;
    this.p2.dead = true;
    audio.stopMusic();
    audio.sfx('explode_11.ogg', 0.6);
    const ex = new ParticleSystem('explodeEffect');
    ex.x = p.x; ex.y = p.y;
    ex.colorOverride = p.style.c1;
    ex.burst();
    this.bursts.push(ex);
    this.circles.push({ x: p.x, y: p.y, t: 0, dur: 0.5, r0: 10, r1: 90, c: p.style.c1, filled: false });
    this.circles.push({ x: p.x, y: p.y, t: 0, dur: 0.4, r0: 0, r1: 70, c: withAlpha(p.style.c2, 0.6), filled: true });
    this.deathTimer = 1.0;
    this.saveProgress(this.percent);
  }

  complete() {
    if (this.completed) return;
    this.completed = true;
    this.completeTimer = 0;
    audio.sfx('endStart_02.ogg', 0.8);
    if (!this.practice) levelProgress(this.info.id).completed = true;
    this.saveProgress(100);
    this.circles.push({ x: this.p1.x, y: this.p1.y, t: 0, dur: 0.8, r0: 10, r1: 200, c: [1, 1, 1, 0.9], filled: false });
    const fx = new ParticleSystem('levelComplete01');
    fx.x = this.p1.x; fx.y = this.p1.y;
    fx.burst();
    this.bursts.push(fx);
    this.buildEndMenu();
  }

  saveProgress(pct) {
    const lp = levelProgress(this.info.id);
    const ip = Math.floor(pct);
    if (this.practice) lp.practice = Math.max(lp.practice, ip);
    else if (ip > lp.normal) {
      lp.normal = ip;
      if (ip < 100) { this.newBestTimer = 0; audio.sfx('highscoreGet02.ogg', 0.6); }
    }
    const jumps = this.p1.jumps - this.jumpsAtStart;
    lp.jumps += jumps;
    save.totalJumps += jumps;
    this.jumpsAtStart = this.p1.jumps;
    if (!this.practice) lp.coins |= this.w.coins;
    writeSave();
  }

  placeCheckpoint() {
    if (!this.practice || this.p1.dead || this.completed) return;
    this.checkpoints.push(this.cloneWorld(this.w));
  }

  // ---------------------------------------------------------------- triggers
  runTriggers() {
    const w = this.w, x = this.p1.x;
    while (w.nextTrigger < this.triggers.length) {
      const o = this.objects[this.triggers[w.nextTrigger]];
      if (o.x > x) break;
      w.nextTrigger++;
      if (!this.isOff(o)) this.trigger(o);
    }
  }

  spawnGroup(g) {
    for (const i of this.groups.get(g) ?? []) {
      const o = this.objects[i];
      if (o.isTrigger && !this.isOff(o)) this.trigger(o);
    }
  }

  trigger(o) {
    const w = this.w, r = o.raw;
    const target = o.id === 899 ? int(r[23], 1) : COLOR_TRIGGER[o.id];
    if (target > 0 && target < NCH) {
      const ch = w.channels[target];
      const to = rgb(int(r[7], 255), int(r[8], 255), int(r[9], 255), num(r[35], 1));
      ch.player = r[15] === '1' ? 1 : r[16] === '1' ? 2 : 0;
      ch.blending = r[17] === '1' || (target === 1002 && o.id === 104);
      ch.copyFrom = int(r[50]);
      ch.hsv = ch.copyFrom ? parseHSV(r[49]) : null;
      const dur = num(r[10], 0.5);
      if (dur <= 0) { ch.color = to; ch.tween = null; }
      else ch.tween = { from: ch.color.slice(), to, t: 0, dur };
      return;
    }
    switch (o.id) {
      case 901:
        w.moves.push({ group: int(r[51]), dx: num(r[28]), dy: num(r[29]), dur: num(r[10], 0.5), t: 0, last: 0, easing: int(r[30]), rate: num(r[85], 2) });
        break;
      case 1346:
        w.rots.push({ group: int(r[51]), center: int(r[71]), deg: num(r[68]) + 360 * int(r[69]), dur: num(r[10], 0.5), t: 0, last: 0,
          easing: int(r[30]), rate: num(r[85], 2), lockRot: r[70] === '1' });
        break;
      case 1007: {
        const g = int(r[51]);
        w.alphas.push({ group: g, from: w.groupAlpha.get(g) ?? 1, to: num(r[35], 1), dur: num(r[10], 0.5), t: 0 });
        break;
      }
      case 1049: w.groupOff.set(int(r[51]), r[56] !== '1'); break;
      case 1006: {
        let color = rgb(int(r[7], 255), int(r[8], 255), int(r[9], 255));
        const copy = int(r[50]);
        if (r[48] === '1' && copy > 0 && copy < NCH) color = applyHSV(this.resolved[copy], parseHSV(r[49]));
        w.pulses.push({ target: int(r[51]), isGroup: r[52] === '1', color, fin: num(r[45]), hold: num(r[46]), fout: num(r[47]), t: 0 });
        break;
      }
      case 1268: {
        const delay = num(r[63]);
        if (delay <= 0) this.spawnGroup(int(r[51]));
        else w.spawns.push({ group: int(r[51]), delay });
        break;
      }
      case 1616: {
        const g = int(r[51]);
        for (const k of ['moves', 'rots', 'alphas', 'follows']) w[k] = w[k].filter((a) => a.group !== g);
        break;
      }
      case 1347: {
        const f = this.groups.get(int(r[71]));
        const lead = f && f.length ? this.objects[f[0]] : null;
        w.follows.push({ group: int(r[51]), follow: int(r[71]), xmod: num(r[72], 1), ymod: num(r[73], 1), dur: num(r[10], 0.5), t: 0,
          lx: lead ? this.objX(lead) : 0, ly: lead ? this.objY(lead) : 0 });
        break;
      }
      case 1520: w.shake = num(r[75], 1); w.shakeTime = num(r[10], 0.5); break;
    }
  }

  moveGroup(g, dx, dy) {
    const w = this.w;
    for (const i of this.groups.get(g) ?? []) { w.offX[i] += dx; w.offY[i] += dy; }
  }

  updateActions(dt) {
    const w = this.w;
    for (const ch of w.channels) {
      if (!ch.tween) continue;
      ch.tween.t += dt;
      const k = Math.min(1, ch.tween.t / ch.tween.dur);
      ch.color = lerpColor(ch.tween.from, ch.tween.to, k);
      if (k >= 1) ch.tween = null;
    }
    for (const m of w.moves) {
      m.t += dt;
      const k = m.dur > 0 ? ease(m.easing, Math.min(1, m.t / m.dur), m.rate) : 1;
      this.moveGroup(m.group, m.dx * (k - m.last), m.dy * (k - m.last));
      m.last = k;
    }
    w.moves = w.moves.filter((m) => m.t < m.dur);
    for (const r of w.rots) {
      r.t += dt;
      const k = r.dur > 0 ? ease(r.easing, Math.min(1, r.t / r.dur), r.rate) : 1;
      const d = r.deg * (k - r.last);
      r.last = k;
      const members = this.groups.get(r.group);
      if (!members) continue;
      const cg = this.groups.get(r.center);
      const center = cg && cg.length && r.center !== r.group ? this.objects[cg[0]] : null;
      const cx = center ? this.objX(center) : 0, cy = center ? this.objY(center) : 0;
      const a = -d * (Math.PI / 180), cs = Math.cos(a), sn = Math.sin(a);
      for (const i of members) {
        if (center) {
          const o = this.objects[i];
          const px = this.objX(o) - cx, py = this.objY(o) - cy;
          w.offX[i] += px * cs - py * sn - px;
          w.offY[i] += px * sn + py * cs - py;
        }
        if (!r.lockRot) w.extraRot[i] += d;
      }
    }
    w.rots = w.rots.filter((r) => r.t < r.dur);
    for (const a of w.alphas) {
      a.t += dt;
      w.groupAlpha.set(a.group, lerp(a.from, a.to, a.dur > 0 ? Math.min(1, a.t / a.dur) : 1));
    }
    w.alphas = w.alphas.filter((a) => a.t < a.dur);
    for (const f of w.follows) {
      f.t += dt;
      const lead = this.groups.get(f.follow);
      if (!lead || !lead.length) continue;
      const o = this.objects[lead[0]];
      const nx = this.objX(o), ny = this.objY(o);
      this.moveGroup(f.group, (nx - f.lx) * f.xmod, (ny - f.ly) * f.ymod);
      f.lx = nx; f.ly = ny;
    }
    w.follows = w.follows.filter((f) => f.t < f.dur);
    for (const p of w.pulses) p.t += dt;
    w.pulses = w.pulses.filter((p) => p.t < p.fin + p.hold + p.fout);
    const due = [];
    for (const s of w.spawns) { s.delay -= dt; if (s.delay <= 0) due.push(s.group); }
    w.spawns = w.spawns.filter((s) => s.delay > 0);
    for (const g of due) this.spawnGroup(g);
  }

  resolveColors() {
    const w = this.w, st = this.p1.style;
    const res = (this.resolved ??= Array.from({ length: NCH }, () => [1, 1, 1, 1]));
    const blend = (this.resolvedBlend ??= new Uint8Array(NCH));
    for (let i = 0; i < NCH; i++) {
      const c = w.channels[i];
      res[i] = c.player === 1 ? withAlpha(st.c1, c.color[3]) : c.player === 2 ? withAlpha(st.c2, c.color[3]) : c.color;
      blend[i] = c.blending ? 1 : 0;
    }
    res[1005] = st.c1; res[1006] = st.c2; blend[1005] = blend[1006] = 1;
    res[1010] = [0, 0, 0, 1];
    res[1011] = [1, 1, 1, 1];
    res[1007] = applyHSV(res[1000], { h: 0, s: 0.75, v: 0.2, sAbs: false, vAbs: true });
    blend[1007] = 1;
    res[1012] = applyHSV(res[1004], { h: 0, s: 0.5, v: 0.3, sAbs: false, vAbs: true });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < NCH; i++) {
        const c = w.channels[i];
        if (c.copyFrom > 0 && c.copyFrom < NCH && c.copyFrom !== i) res[i] = withAlpha(applyHSV(res[c.copyFrom], c.hsv ?? { h: 0, s: 1, v: 1 }), c.color[3]);
      }
    }
    this.groupPulse = new Map();
    for (const p of w.pulses) {
      let k;
      if (p.t < p.fin) k = p.fin > 0 ? p.t / p.fin : 1;
      else if (p.t < p.fin + p.hold) k = 1;
      else k = p.fout > 0 ? 1 - (p.t - p.fin - p.hold) / p.fout : 0;
      k = clamp(k, 0, 1);
      if (p.isGroup) this.groupPulse.set(p.target, [p.color, k]);
      else if (p.target > 0 && p.target < NCH) res[p.target] = lerpColor(res[p.target], withAlpha(p.color, res[p.target][3]), k);
    }
  }

  updateCamera(dt, snap) {
    const w = this.w, W = app.W, H = app.H, p = this.p1;
    if (!p.dead) w.camX = Math.min(p.x - (W / 2 - 75), this.levelEnd - W + 60);
    let target = w.camY;
    if (w.bounded) target = (w.floorY + w.ceilY) / 2 - H / 2;
    else {
      const top = p.flipped ? 120 : 90, bottom = p.flipped ? 90 : 120;
      if (p.y > w.camY + H - top) target = p.y - H + top;
      else if (p.y < w.camY + bottom) target = p.y - bottom;
      if (!p.flipped && p.onGround && p.y <= 15.5 * p.size + 0.5) target = -90;
    }
    target = clamp(target, -90, 1500);
    const k = snap ? 1 : 1 - Math.exp(-dt * 7);
    w.camY += (target - w.camY) * k;
    const fT = w.bounded ? w.floorY : 0, cT = w.bounded ? w.ceilY : w.camY + H + 150;
    const kg = snap ? 1 : 1 - Math.exp(-dt * 9);
    w.floorVis += (fT - w.floorVis) * kg;
    w.ceilVis += (cT - w.ceilVis) * kg;
    w.mirrorT += ((w.mirrored ? 1 : 0) - w.mirrorT) * (snap ? 1 : Math.min(1, dt * 4));
    if (w.shakeTime > 0) w.shakeTime -= dt;
  }

  // ---------------------------------------------------------------- scene interface
  update(dt) {
    this.pauseBtn.update(dt);
    if (this.paused) { this.pauseMenu.update(dt); return; }
    const p = this.p1;
    if (!this.musicStarted && !p.dead && !this.completed) this.startMusic();
    const frames = Math.min(dt * 60, 2);
    if (!p.dead && !this.completed) {
      this.physics(frames);
      this.w.time += dt;
      this.playTime += dt;
      this.runTriggers();
      if (this.practice) {
        this.autoCheckpoint += dt;
        if (this.autoCheckpoint > 2.5 && (p.onGround || p.isFlyer) && !p.dead) {
          this.placeCheckpoint();
          this.autoCheckpoint = 0;
        }
      }
    } else if (this.completed) {
      this.completeTimer += dt;
      p.px = p.x;
      if (p.x < this.levelEnd + 200) p.x += p.xSpeed * frames;
      if (this.completeTimer > 2.2) this.showEnd = true;
      this.endMenu.update(dt);
    }
    this.updateActions(dt);
    this.resolveColors();
    this.updateCamera(dt, false);
    this.p1.updateVisual(dt);
    if (this.w.dual) this.p2.updateVisual(dt);
    for (const c of this.circles) c.t += dt;
    this.circles = this.circles.filter((c) => c.t < c.dur);
    for (const b of this.bursts) b.update(dt);
    this.bursts = this.bursts.filter((b) => b.alive);
    if (this.newBestTimer >= 0) this.newBestTimer += dt;

    if (this.deathTimer > 0) {
      this.deathTimer -= dt;
      if (this.deathTimer <= 0) {
        this.attempt++;
        const lp = levelProgress(this.info.id);
        lp.attempts++;
        save.totalAttempts++;
        writeSave();
        this.reset(this.practice);
      }
    }
  }

  event(e) {
    if (this.paused) {
      if (this.pauseMenu.event(e)) return;
      if (e.type === 'keydown' && !e.repeat && (e.code === KEY.ESC || e.code === KEY.P || e.code === KEY.SPACE)) this.togglePause();
      return;
    }
    if (this.showEnd) {
      this.endMenu.event(e);
      if (e.type === 'keydown' && e.code === KEY.ESC) this.exit();
      return;
    }
    const jumpKey = e.code === KEY.SPACE || e.code === KEY.UP || e.code === KEY.W;
    switch (e.type) {
      case 'down':
        if (this.pauseBtn.hit(e.x, e.y)) { this.pauseBtn.pressed = true; return; }
        this.pointerHeld = true;
        this.p1.press();
        break;
      case 'up':
        if (this.pauseBtn.pressed) {
          this.pauseBtn.pressed = false;
          if (this.pauseBtn.hit(e.x, e.y)) this.togglePause();
          return;
        }
        this.pointerHeld = false;
        if (!this.keyHeld) this.p1.release();
        break;
      case 'keydown':
        if (e.repeat) return;
        if (jumpKey) { this.keyHeld = true; this.p1.press(); }
        else if (e.code === KEY.ESC || e.code === KEY.P) this.togglePause();
        else if (e.code === KEY.R) { this.checkpoints = []; this.reset(false); }
        else if (e.code === KEY.Z) this.placeCheckpoint();
        else if (e.code === KEY.X && this.practice) this.checkpoints.pop();
        break;
      case 'keyup':
        if (jumpKey) { this.keyHeld = false; if (!this.pointerHeld) this.p1.release(); }
        break;
      case 'blur':
        this.keyHeld = this.pointerHeld = false;
        this.p1.release();
        if (!this.p1.dead && !this.completed && !this.paused) this.togglePause();
        break;
    }
  }

  togglePause() {
    if (this.completed || this.p1.dead) return;
    this.paused = !this.paused;
    if (this.paused) {
      audio.stopMusic(0.1);
      this.p1.release();
      this.keyHeld = this.pointerHeld = false;
      this.buildPauseMenu();
    } else this.musicStarted = false; // resumes at the current level time
  }

  exit() {
    audio.stopMusic(0.3);
    audio.sfx('quitSound_01.ogg', 0.7);
    if (!this.completed && !this.p1.dead) this.saveProgress(this.percent);
    import('../scenes/levelselect.js').then(({ LevelSelect }) => app.setScene(() => new LevelSelect(this.info.id)));
  }

  setPractice(on) {
    this.practice = on;
    this.checkpoints = [];
    audio.stopMusic();
    audio.load(this.song);
    this.paused = false;
    this.reset(false);
  }

  buildPauseMenu() {
    const m = this.pauseMenu, W = app.W, H = app.H, y = H / 2 - 70;
    m.clear();
    m.add(new Button({ frame: this.practice ? 'GJ_normalBtn_001.png' : 'GJ_practiceBtn_001.png', x: W / 2 - 190, y, scale: 0.9, onClick: () => this.setPractice(!this.practice) }));
    m.add(new Button({ frame: 'GJ_playBtn2_001.png', x: W / 2 - 95, y, onClick: () => this.togglePause() }));
    m.add(new Button({ frame: 'GJ_replayBtn_001.png', x: W / 2 + 95, y, scale: 0.9, onClick: () => { this.paused = false; this.checkpoints = []; this.reset(false); } }));
    m.add(new Button({ frame: 'GJ_menuBtn_001.png', x: W / 2 + 190, y, scale: 0.9, onClick: () => this.exit() }));
  }

  buildEndMenu() {
    const m = this.endMenu, W = app.W, H = app.H;
    m.clear();
    m.add(new Button({ frame: 'GJ_replayBtn_001.png', x: W / 2 - 60, y: H / 2 - 85, onClick: () => { this.checkpoints = []; this.attempt++; this.reset(false); } }));
    m.add(new Button({ frame: 'GJ_menuBtn_001.png', x: W / 2 + 60, y: H / 2 - 85, onClick: () => this.exit() }));
  }

  // ---------------------------------------------------------------- rendering
  channelColor(ch) { return ch > 0 && ch < NCH ? this.resolved[ch] : [1, 1, 1, 1]; }

  drawBackground() {
    const r = gfx.r, W = app.W, H = app.H, w = this.w;
    const bg = r.image(`tex/game_bg_${String(clamp(this.level.settings.background, 1, 59)).padStart(2, '0')}_001.png`);
    const c = withAlpha(this.channelColor(1000), 1);
    r.drawRect(0, 0, W, H, c);
    if (!bg.tex.ready || bg.w <= 0) return;
    const s = Math.max(1, H / bg.h), tw = bg.w * s;
    let px = (w.camX * 0.1) % tw;
    if (px < 0) px += tw;
    const py = Math.min(0, Math.max(-(w.camY + 90) * 0.1 - 20, H - bg.h * s));
    for (let x = -px; x < W; x += tw) r.drawFrame(bg, Affine.make(x, py, 0, s, s), c, false, 0, 0);
  }

  drawGround(view) {
    const r = gfx.r, W = app.W, w = this.w, st = this.level.settings;
    const gid = clamp(st.ground, 1, 22), id = String(gid).padStart(2, '0');
    const g1 = r.image(`tex/groundSquare_${id}_001.png`);
    const g2 = gid >= 8 ? r.image(`tex/groundSquare_${id}_2_001.png`) : null;
    const line = r.frame(st.groundLine === 2 ? 'floorLine_02_001.png' : 'floorLine_001.png');
    const shadow = r.frame('groundSquareShadow_001.png');
    const gc = withAlpha(this.channelColor(1001), 1), gc2 = withAlpha(this.channelColor(1009), 1), lc = withAlpha(this.channelColor(1002), 1);
    const strip = (worldY, ceiling) => {
      const sy = view.applyY(w.camX, worldY);
      if (!g1.tex.ready || g1.w <= 0) {
        r.drawRect(0, ceiling ? sy : sy - 400, W, 400, gc);
        return;
      }
      const tw = g1.w;
      let off = w.camX % tw;
      if (off < 0) off += tw;
      for (let x = -off; x < W; x += tw) {
        const m = Affine.make(x, sy, 0, 1, ceiling ? -1 : 1);
        r.drawFrame(g1, m, gc, false, 0, 1);
        if (g2 && g2.tex.ready) r.drawFrame(g2, m, gc2, false, 0, 1);
      }
      r.drawRect(0, ceiling ? sy + g1.h : sy - g1.h - 400, W, 400, gc);
      if (shadow) {
        r.drawFrame(shadow, Affine.make(0, sy, 0, 1, ceiling ? -1 : 1), [1, 1, 1, 1], false, 0, 1);
        r.drawFrame(shadow, Affine.make(W, sy, 0, -1, ceiling ? -1 : 1), [1, 1, 1, 1], false, 0, 1);
      }
      if (line) r.drawFrame(line, Affine.make(W / 2, sy, 0, W / line.sw, ceiling ? -1 : 1), lc, true, 0.5, 1);
    };
    strip(w.floorVis, false);
    if (view.applyY(0, w.ceilVis) < app.H + 10) strip(w.ceilVis, true);
  }

  drawObject(view, o, alpha) {
    const r = gfx.r, w = this.w;
    const m = view.mul(Affine.make(this.objX(o), this.objY(o), o.rot + w.extraRot[o.index], o.scaleX * (o.flipX ? -1 : 1), o.scaleY * (o.flipY ? -1 : 1)));
    let pulse = null;
    for (const g of o.groups) { const p = this.groupPulse.get(g); if (p) pulse = p; }
    for (const part of o.def.parts) {
      let ch = 0, c = part.fixed, add = false;
      if (part.slot === SLOT.Base) ch = o.ch1;
      else if (part.slot === SLOT.Detail) ch = o.def.hasBase ? o.ch2 : o.ch1;
      if (ch > 0) { c = this.channelColor(ch); add = this.resolvedBlend[ch] === 1; }
      if (pulse) c = lerpColor(c, withAlpha(pulse[0], c[3]), pulse[1]);
      r.drawFrame(part.frame, m.mul(part.local), [c[0], c[1], c[2], c[3] * alpha], add);
    }
  }

  draw() {
    const r = gfx.r, W = app.W, H = app.H, w = this.w;
    this.drawBackground();
    let sx = 0, sy = 0;
    if (w.shakeTime > 0) { sx = (Math.random() - 0.5) * 2 * w.shake; sy = (Math.random() - 0.5) * 2 * w.shake; }
    let view = Affine.translate(-w.camX + sx, -w.camY + sy);
    if (w.mirrorT > 0.001) view = Affine.translate(W / 2, 0).mul(Affine.make(0, 0, 0, 1 - 2 * w.mirrorT, 1)).mul(Affine.translate(-W / 2, 0)).mul(view);

    const vis = [];
    const x0 = w.camX - 60, x1 = w.camX + W + 60;
    this.forEachNear(x0, x1, (o) => {
      if (o.isTrigger || this.isOff(o)) return;
      const ox = this.objX(o), oy = this.objY(o) - w.camY;
      if (ox + o.extent < x0 || ox - o.extent > x1 || oy + o.extent < -40 || oy - o.extent > H + 40) return;
      vis.push(o);
    });
    vis.sort((a, b) => a.sortKey - b.sortKey);
    const fadeOf = (o) => {
      const s = view.applyX(this.objX(o), this.objY(o));
      return clamp((Math.min(s, W - s) + 20) / 80, 0, 1);
    };
    const drawRange = (lo, hi) => {
      for (const o of vis) {
        if (o.zLayer < lo || o.zLayer > hi) continue;
        const a = fadeOf(o) * this.groupAlpha(o);
        if (a > 0.01) this.drawObject(view, o, a);
      }
    };
    drawRange(-100, PLAYER_LAYER - 1);
    for (const o of vis) {
      if (!o.def.backFrame) continue;
      const m = view.mul(Affine.make(this.objX(o), this.objY(o), o.rot + w.extraRot[o.index], o.scaleX * (o.flipX ? -1 : 1), o.scaleY * (o.flipY ? -1 : 1)));
      r.drawFrame(o.def.backFrame, m, [1, 1, 1, fadeOf(o)]);
    }
    const hidePlayer = this.completed && this.completeTimer > 0.3;
    this.p1.draw(view, hidePlayer ? 0 : 1);
    if (w.dual) this.p2.draw(view);
    drawRange(PLAYER_LAYER, 100);

    for (const b of this.bursts) b.draw(view.tx, view.ty);
    for (const c of this.circles) {
      const k = c.t / c.dur, rad = lerp(c.r0, c.r1, 1 - (1 - k) * (1 - k));
      const col = withAlpha(c.c, c.c[3] * (1 - k));
      const px = view.applyX(c.x, c.y), py = view.applyY(c.x, c.y);
      if (c.filled) r.drawCircle(px, py, rad, col);
      else r.drawRing(px, py, rad, 3 * (1 - k) + 1, col);
    }

    if (!this.practice || !this.checkpoints.length) {
      const ax = view.applyX(220, 150), ay = view.applyY(220, 150);
      if (ax > -200) fonts.big.draw(`Attempt ${this.attempt}`, ax, ay, 0.65, [1, 1, 1, 1]);
    }
    this.drawGround(view);
    if (this.practice) {
      const cp = r.frame('checkpoint_01_001.png');
      for (const c of this.checkpoints) r.drawFrame(cp, Affine.translate(view.applyX(c.p1.x, c.p1.y), view.applyY(c.p1.x, c.p1.y)), [1, 1, 1, 1]);
    }
    this.drawHUD();
    if (this.paused) this.drawPause();
    if (this.showEnd) this.drawEnd();
  }

  drawProgressBar(cx, cy, scale, pct, fill) {
    const r = gfx.r, bar = r.image('tex/GJ_progressBar_001.png');
    if (!bar.tex.ready || bar.w <= 0) return;
    const m = Affine.make(cx, cy, 0, scale, scale);
    r.drawFrame(bar, m, [0, 0, 0, 0.5]);
    const k = clamp(pct / 100, 0, 1);
    if (k <= 0) return;
    const fm = m.mul(Affine.make(0, 0, 0, 0.985, 0.84)).mul(Affine.translate(-bar.w / 2, -bar.h / 2));
    r.drawFramePart(bar, fm, fill, 0, 0, k, 1);
  }

  drawHUD() {
    const r = gfx.r, W = app.W, H = app.H;
    if (!this.completed) {
      this.drawProgressBar(W / 2, H - 8, 0.5, this.percent, rgb(0, 255, 0));
      if (save.showPercent) {
        const bar = r.image('tex/GJ_progressBar_001.png');
        fonts.big.draw(`${Math.floor(this.percent)}%`, W / 2 + (bar.w > 0 ? bar.w * 0.25 : 100) + 6, H - 8, 0.4, [1, 1, 1, 1], 0, 0.5);
      }
      this.pauseBtn.x = W - 18;
      this.pauseBtn.y = H - 18;
      this.pauseBtn.draw();
    }
    if (this.practice) fonts.big.draw('Practice Mode', W / 2, H - 24, 0.35, [1, 1, 1, 0.6]);
    if (this.newBestTimer >= 0 && this.newBestTimer < 1.4) {
      const t = this.newBestTimer;
      const a = t < 1 ? 1 : 1 - (t - 1) / 0.4, s = 0.8 + 0.2 * Math.min(1, t * 6);
      fonts.gold.draw('New Best!', W / 2, H * 0.62, s, [1, 1, 1, a]);
      fonts.big.draw(`${levelProgress(this.info.id).normal}%`, W / 2, H * 0.62 - 30, 0.9 * s, [1, 1, 1, a]);
    }
    if (this.completed && !this.showEnd) {
      const f = r.frame(this.practice ? 'GJ_practiceComplete_001.png' : 'GJ_levelComplete_001.png');
      const t = this.completeTimer;
      const s = t < 0.4 ? (t / 0.4) * 1.1 : 1.1 - Math.min(0.1, (t - 0.4) * 0.5);
      r.drawFrame(f, Affine.make(W / 2, H * 0.6, 0, s, s), [1, 1, 1, 1]);
    }
  }

  drawPause() {
    const r = gfx.r, W = app.W, H = app.H, lp = levelProgress(this.info.id);
    r.drawRect(0, 0, W, H, [0, 0, 0, 0.55]);
    drawBox(W / 2, H / 2, Math.min(W - 40, 480), 280, 1, 0.9);
    fonts.big.draw(this.info.name, W / 2, H / 2 + 110, 0.8, [1, 1, 1, 1]);
    fonts.big.draw('Normal Mode', W / 2, H / 2 + 70, 0.45, [1, 1, 1, 1]);
    this.drawProgressBar(W / 2, H / 2 + 48, 0.75, lp.normal, rgb(0, 255, 0));
    fonts.big.draw(`${lp.normal}%`, W / 2, H / 2 + 48, 0.4, [1, 1, 1, 1]);
    fonts.big.draw('Practice Mode', W / 2, H / 2 + 20, 0.45, [1, 1, 1, 1]);
    this.drawProgressBar(W / 2, H / 2 - 2, 0.75, lp.practice, rgb(0, 255, 255));
    fonts.big.draw(`${lp.practice}%`, W / 2, H / 2 - 2, 0.4, [1, 1, 1, 1]);
    this.pauseMenu.draw();
    if (this.practice) fonts.chat.draw('Z: place checkpoint   X: remove checkpoint', W / 2, H / 2 - 122, 0.5, [1, 1, 1, 0.7]);
    fonts.chat.draw(`${CREDIT} - github.com/yaanscoat`, W / 2, 10, 0.45, [1, 1, 1, 0.6]);
  }

  drawEnd() {
    const r = gfx.r, W = app.W, H = app.H;
    r.drawRect(0, 0, W, H, [0, 0, 0, 0.45]);
    drawBox(W / 2, H / 2, Math.min(W - 40, 400), 250, 1, 0.95);
    const f = r.frame(this.practice ? 'GJ_practiceComplete_001.png' : 'GJ_levelComplete_001.png');
    r.drawFrame(f, Affine.make(W / 2, H / 2 + 90, 0, 0.7, 0.7), [1, 1, 1, 1]);
    const secs = Math.floor(this.playTime);
    fonts.gold.draw(`Attempts: ${this.attempt}`, W / 2, H / 2 + 40, 0.7, [1, 1, 1, 1]);
    fonts.gold.draw(`Jumps: ${this.p1.jumps}`, W / 2, H / 2 + 12, 0.7, [1, 1, 1, 1]);
    fonts.gold.draw(`Time: ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`, W / 2, H / 2 - 16, 0.7, [1, 1, 1, 1]);
    const n = Math.min(3, this.coinOrder.length);
    for (let i = 0; i < n; i++) {
      const c = r.frame((this.w.coins >> i) & 1 ? 'GJ_coinsIcon_001.png' : 'GJ_coinsIcon_gray_001.png');
      r.drawFrame(c, Affine.make(W / 2 + (i - (n - 1) / 2) * 26, H / 2 - 44, 0, 0.8, 0.8), [1, 1, 1, 1]);
    }
    this.endMenu.draw();
    fonts.chat.draw(`${CREDIT} - github.com/yaanscoat`, W / 2, 10, 0.45, [1, 1, 1, 0.6]);
  }
}
