// The player: physics for every gamemode, rotation, icon drawing and trail effects.
// Units: 30 per block, velocities per 60 fps frame (as in the original game).
import { json } from '../core/assets.js';
import { Affine, DEG2RAD, Rect, clamp, lerp, withAlpha } from '../core/math.js';
import { gfx } from '../gfx/renderer.js';
import { ParticleSystem } from './particles.js';

export const GM = { Cube: 0, Ship: 1, Ball: 2, Ufo: 3, Wave: 4, Robot: 5, Spider: 6, Swing: 7 };
export const GRAVITY = 0.958199;
export const JUMP = 11.180032;
// x speed per frame: normal, slow, fast, faster, fastest
export const SPEEDS = [0.9 * 5.77, 0.7 * 5.98, 1.1 * 5.87, 1.3 * 6.0, 1.6 * 6.0];

// ---------------------------------------------------------------- icons

const pad2 = (n) => String(n).padStart(2, '0');

function drawLayered(prefix, id, m, c1, c2, glow, alpha) {
  const r = gfx.r;
  const f = (suffix) => r.frame(`${prefix}_${pad2(id)}${suffix}_001.png`);
  if (glow) { const g = f('_glow'); if (g) r.drawFrame(g, m, withAlpha(c2, alpha)); }
  const s2 = f('_2'); if (s2) r.drawFrame(s2, m, withAlpha(c2, alpha));
  const s1 = f(''); if (s1) r.drawFrame(s1, m, withAlpha(c1, alpha));
  const s3 = f('_3'); if (s3) r.drawFrame(s3, m, [1, 1, 1, alpha]);
  const ex = f('_extra'); if (ex) r.drawFrame(ex, m, [1, 1, 1, alpha]);
}

function drawParts(kind, id, m, c1, c2, glow, alpha, anim, t) {
  const r = gfx.r;
  const anims = json('anims.json')[kind];
  let frames = anims[anim] || anims.idle;
  if (!frames || !frames.length) return;
  const delay = kind === 'robot' ? 0.0275 : 0.04;
  const sprites = [...frames[Math.floor(t / delay) % frames.length]].sort((a, b) => a.z - b.z);
  const backCount = kind === 'robot' ? sprites.length - 4 : 0;
  for (let pass = glow ? 0 : 1; pass < 2; pass++) {
    sprites.forEach((s, i) => {
      const pm = m.mul(Affine.make(s.x, s.y, s.r, s.sx * (s.fx ? -1 : 1), s.sy * (s.fy ? -1 : 1)));
      const base = `${kind}_${pad2(id)}_${pad2(s.p)}`;
      if (pass === 0) { const g = r.frame(`${base}_glow_001.png`); if (g) r.drawFrame(g, pm, withAlpha(c2, alpha)); return; }
      const dk = i < backCount ? 0.6 : 1;
      const f2 = r.frame(`${base}_2_001.png`); if (f2) r.drawFrame(f2, pm, [c2[0] * dk, c2[1] * dk, c2[2] * dk, alpha]);
      const f1 = r.frame(`${base}_001.png`); if (f1) r.drawFrame(f1, pm, [c1[0] * dk, c1[1] * dk, c1[2] * dk, alpha]);
      const fx = r.frame(`${base}_extra_001.png`); if (fx) r.drawFrame(fx, pm, [dk, dk, dk, alpha]);
    });
  }
}

// Draws one icon of a gamemode kind centered at the transform's origin.
export function drawIcon(kind, id, m, c1, c2, glow = false, alpha = 1, anim = 'idle', t = 0) {
  switch (kind) {
    case GM.Cube: return drawLayered('player', id, m, c1, c2, glow, alpha);
    case GM.Ship: return drawLayered('ship', id, m, c1, c2, glow, alpha);
    case GM.Ball: return drawLayered('player_ball', id, m, c1, c2, glow, alpha);
    case GM.Ufo: {
      const r = gfx.r;
      const dome = r.frame(`bird_${pad2(id)}_3_001.png`);
      if (dome) r.drawFrame(dome, m, [1, 1, 1, alpha]);
      const f = (s) => r.frame(`bird_${pad2(id)}${s}_001.png`);
      if (glow && f('_glow')) r.drawFrame(f('_glow'), m, withAlpha(c2, alpha));
      if (f('_2')) r.drawFrame(f('_2'), m, withAlpha(c2, alpha));
      if (f('')) r.drawFrame(f(''), m, withAlpha(c1, alpha));
      if (f('_extra')) r.drawFrame(f('_extra'), m, [1, 1, 1, alpha]);
      return;
    }
    case GM.Wave: return drawLayered('dart', id, m, c1, c2, glow, alpha);
    case GM.Robot: return drawParts('robot', id, m, c1, c2, glow, alpha, anim, t);
    case GM.Spider: return drawParts('spider', id, m, c1, c2, glow, alpha, anim, t);
    case GM.Swing: return drawLayered('swing', id, m, c1, c2, glow, alpha);
  }
}

// ---------------------------------------------------------------- player

export class Player {
  constructor(style) {
    this.style = style; // {ids: [8], c1, c2, glow}
    this.drag = new ParticleSystem('dragEffect');
    this.fire = new ParticleSystem('dragEffect');
    this.fire.speed *= 0.2; this.fire.speedVar *= 0.2; this.fire.angleVar *= 2;
    this.fire.startSize *= 1.5; this.fire.startSizeVar *= 1.5;
    this.land = new ParticleSystem('landEffect');
    this.shipDrag = new ParticleSystem('shipDragEffect');
    this.reset(0, 15, GM.Cube, false, false, 0);
  }

  reset(x, y, mode, mini, flipped, speed) {
    this.x = this.px = x;
    this.y = this.py = y;
    this.yVel = 0;
    this.mode = mode;
    this.mini = mini;
    this.flipped = flipped;
    this.onGround = this.onCeiling = this.wasOnGround = false;
    this.holding = this.pressBuffered = this.justPressed = false;
    this.dead = false;
    this.spiderJump = false;
    this.speed = speed;
    this.rotation = 0;
    this.jumps = 0;
    this.robotBoosting = false;
    this.robotBoost = 0;
    this.animTime = 0;
    this.snapT = 1;
    for (const ps of [this.drag, this.fire, this.land, this.shipDrag]) { ps.reset(); ps.stop(); }
  }

  // Copies physics state (used for checkpoints and dual mode); particles are not copied.
  snapshot() {
    const s = {};
    for (const k of ['x', 'y', 'px', 'py', 'yVel', 'mode', 'mini', 'flipped', 'onGround', 'onCeiling', 'dead', 'speed',
      'rotation', 'jumps', 'robotBoosting', 'robotBoost']) s[k] = this[k];
    return s;
  }
  restore(s) { Object.assign(this, s); this.holding = this.pressBuffered = this.justPressed = false; this.spiderJump = false; }

  get size() { return this.mini ? 0.6 : 1; }
  get flip() { return this.flipped ? -1 : 1; }
  get xSpeed() { return SPEEDS[this.speed]; }
  get isFlyer() { return this.mode === GM.Ship || this.mode === GM.Ufo || this.mode === GM.Wave || this.mode === GM.Swing; }
  get falling() { return this.flipped ? this.yVel > GRAVITY : this.yVel < GRAVITY; }

  outer() {
    const s = this.mode === GM.Wave ? (this.mini ? 6 : 10) : 30 * this.size;
    return Rect.centered(this.x, this.y, s, s);
  }
  inner() {
    const s = this.mode === GM.Wave ? (this.mini ? 3.6 : 6) : 9 * this.size;
    return Rect.centered(this.x, this.y, s, s);
  }

  setGamemode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.robotBoosting = false;
    if (m === GM.Ship || m === GM.Ufo || m === GM.Swing) this.yVel *= 0.5;
    if (m !== GM.Ball) this.rotation = m === GM.Cube || m === GM.Ship || m === GM.Swing ? this.rotation : 0;
    this.onGround = false;
  }

  flipGravity(f, halve = true) {
    if (this.flipped === f) return;
    this.flipped = f;
    if (halve) this.yVel *= 0.5;
    this.onGround = this.onCeiling = false;
  }

  press() { this.holding = true; this.pressBuffered = true; this.justPressed = true; }
  release() { this.holding = false; this.pressBuffered = false; this.justPressed = false; }

  // One physics substep; dt in 60 fps frames.
  step(dt) {
    if (this.dead) return;
    this.px = this.x;
    this.py = this.y;
    const dtY = dt * 0.9, g = GRAVITY, fl = this.flip;
    const fly = this.mini ? 0.85 : 1;
    const clampFall = (lim) => { this.yVel = this.flipped ? Math.min(this.yVel, lim) : Math.max(this.yVel, -lim); };
    const clampFly = () => {
      const up = 8 / fly, down = 6.4 / fly;
      this.yVel = this.flipped ? clamp(this.yVel, -up, down) : clamp(this.yVel, -down, up);
    };

    switch (this.mode) {
      case GM.Cube: {
        if (this.holding && this.onGround) {
          this.yVel = fl * JUMP * (this.mini ? 0.8 : 1);
          this.onGround = false;
          this.pressBuffered = false;
          this.jumps++;
        } else {
          this.yVel -= g * dtY * fl;
          clampFall(15);
        }
        break;
      }
      case GM.Ball: {
        if (this.pressBuffered && (this.onGround || this.onCeiling)) {
          this.pressBuffered = false;
          this.flipGravity(!this.flipped, false);
          this.yVel = fl * JUMP * 0.5 * 0.6;
          this.jumps++;
        } else {
          this.yVel -= g * dtY * fl * 0.6;
          clampFall(15);
        }
        break;
      }
      case GM.Ship: {
        const accel = this.holding ? -1 : this.falling ? 0.8 : 1.2;
        const boost = this.holding && this.falling ? 0.5 : 0.4;
        this.yVel -= (g * dtY * fl * accel * boost) / fly;
        clampFly();
        break;
      }
      case GM.Ufo: {
        if (this.justPressed) {
          this.justPressed = false;
          this.pressBuffered = false;
          const nv = fl * (this.mini ? 8 : 7) * fly;
          if ((!this.flipped && this.yVel < nv) || (this.flipped && this.yVel > nv)) this.yVel = nv;
          this.jumps++;
        }
        this.yVel -= (g * dtY * fl * (this.falling ? 0.8 : 1.2) * 0.5) / fly;
        clampFly();
        break;
      }
      case GM.Wave: {
        if (this.justPressed) { this.justPressed = false; this.jumps++; }
        this.yVel = ((this.holding ? fl : -fl) * this.xSpeed * (this.mini ? 2 : 1)) / 0.9;
        break;
      }
      case GM.Robot: {
        const jv = 7 * (this.mini ? 0.8 : 1);
        if (this.holding && this.onGround) {
          this.yVel = fl * jv;
          this.onGround = false;
          this.pressBuffered = false;
          this.robotBoosting = true;
          this.robotBoost = 0;
          this.jumps++;
        } else if (this.robotBoosting && this.holding && this.robotBoost < 12.5) {
          this.robotBoost += dt;
          this.yVel = fl * jv;
        } else {
          this.robotBoosting = false;
          this.yVel -= g * dtY * fl;
          clampFall(15);
        }
        break;
      }
      case GM.Spider: {
        if (this.pressBuffered && this.onGround) {
          this.pressBuffered = false;
          this.spiderJump = true;
          this.jumps++;
        }
        this.yVel -= g * dtY * fl;
        clampFall(15);
        break;
      }
      case GM.Swing: {
        if (this.justPressed) {
          this.justPressed = false;
          this.pressBuffered = false;
          this.flipGravity(!this.flipped, false);
          this.jumps++;
        }
        this.yVel -= (g * dtY * this.flip * (this.falling ? 0.8 : 1.2) * 0.5) / fly;
        clampFly();
        break;
      }
    }
    this.x += this.xSpeed * dt;
    this.y += this.yVel * dtY;
  }

  hitGround() {
    const wasAir = !this.onGround;
    this.yVel = 0;
    this.onGround = true;
    this.robotBoosting = false;
    if (wasAir && !this.wasOnGround && (this.mode === GM.Cube || this.mode === GM.Robot || this.mode === GM.Ball || this.mode === GM.Spider)) {
      this.land.x = this.x;
      this.land.y = this.y - 15 * this.size * this.flip;
      this.land.scale = this.size;
      this.land.gravityScaleY = this.flip;
      this.land.angleOffset = this.flipped ? 180 : 0;
      this.land.burst();
    }
  }

  hitCeiling() { this.yVel = 0; this.onCeiling = true; }

  updateVisual(dt) {
    this.animTime += dt;
    const fl = this.flip;
    switch (this.mode) {
      case GM.Cube:
        if (!this.onGround) {
          this.rotation += ((fl * (180 / 0.41)) / (this.mini ? 0.8 : 1)) * dt;
          this.snapT = 1;
        } else {
          const snapped = Math.round(this.rotation / 90) * 90;
          if (this.snapT >= 1 && Math.abs(snapped - this.rotation) > 0.01) {
            this.snapFrom = this.rotation;
            this.snapTo = snapped;
            this.snapT = 0;
          }
          if (this.snapT < 1) {
            this.snapT = Math.min(1, this.snapT + dt / 0.075);
            this.rotation = lerp(this.snapFrom, this.snapTo, this.snapT);
          }
        }
        this.rotation %= 360;
        break;
      case GM.Ship:
      case GM.Swing: {
        const dx = this.x - this.px, dy = this.y - this.py;
        if (dx > 1e-4) {
          const target = this.onGround || this.onCeiling ? 0 : -Math.atan2(dy, dx) / DEG2RAD;
          this.rotation = lerp(this.rotation, target, Math.min(1, dt * 15));
        }
        break;
      }
      case GM.Ball:
        this.rotation = (this.rotation + fl * 720 * dt) % 360;
        break;
      case GM.Wave: {
        const ang = this.mini ? 63.4 : 45;
        let target = (this.holding ? -ang : ang) * fl;
        if ((this.onGround && !this.holding) || (this.onCeiling && this.holding)) target = 0;
        this.rotation = lerp(this.rotation, target, Math.min(1, dt * 30));
        break;
      }
      default:
        this.rotation = 0;
    }

    const c1 = this.style.c1, s = this.size;
    const toggle = (ps, on) => { if (on && !ps.active) ps.start(); if (!on && ps.active) ps.stop(); };

    this.drag.colorOverride = c1;
    this.drag.scale = s;
    this.drag.gravityScaleY = fl;
    this.drag.angleOffset = this.flipped ? 180 : 0;
    this.drag.x = this.x - 10 * s;
    this.drag.y = this.y - 13 * s * fl;
    toggle(this.drag, !this.dead && this.onGround && (this.mode === GM.Cube || this.mode === GM.Robot || this.mode === GM.Ball || this.mode === GM.Spider));

    const rr = -this.rotation * DEG2RAD, bx = -12 * s, by = -4 * s * fl;
    this.fire.colorOverride = c1;
    this.fire.scale = s;
    this.fire.x = this.x + bx * Math.cos(rr) - by * Math.sin(rr);
    this.fire.y = this.y + bx * Math.sin(rr) + by * Math.cos(rr);
    toggle(this.fire, !this.dead && (this.mode === GM.Ship || this.mode === GM.Swing) && this.holding);

    this.shipDrag.x = this.x;
    this.shipDrag.y = this.y - 15 * s * fl;
    this.shipDrag.gravityScaleY = fl;
    toggle(this.shipDrag, !this.dead && this.mode === GM.Ship && (this.onGround || this.onCeiling));

    for (const ps of [this.drag, this.fire, this.land, this.shipDrag]) ps.update(dt);
    this.wasOnGround = this.onGround;
  }

  // view: world -> screen transform
  draw(view, alpha = 1) {
    for (const ps of [this.drag, this.fire, this.land, this.shipDrag]) ps.draw(view.tx, view.ty);
    if (this.dead || alpha <= 0) return;
    const s = this.size;
    const fy = this.flipped && this.mode !== GM.Cube && this.mode !== GM.Ball ? -1 : 1;
    const base = view.mul(Affine.make(this.x, this.y, this.rotation, s, s * fy));
    const st = this.style;
    switch (this.mode) {
      case GM.Ship:
      case GM.Ufo:
        drawIcon(GM.Cube, st.ids[GM.Cube], base.mul(Affine.make(0, 5, 0, 0.55, 0.55)), st.c1, st.c2, st.glow, alpha);
        drawIcon(this.mode, st.ids[this.mode], base.mul(Affine.translate(0, this.mode === GM.Ship ? -5 : -7)), st.c1, st.c2, st.glow, alpha);
        break;
      case GM.Robot:
      case GM.Spider: {
        const anim = this.onGround ? 'run' : this.mode === GM.Robot && this.yVel * this.flip > 0 ? 'jump_loop' : 'fall_loop';
        drawIcon(this.mode, st.ids[this.mode], base, st.c1, st.c2, st.glow, alpha, anim, this.animTime);
        break;
      }
      default:
        drawIcon(this.mode, st.ids[this.mode], base, st.c1, st.c2, st.glow, alpha);
    }
  }
}
