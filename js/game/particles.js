// Cocos2d-style particle emitter driven by the game's own effect definitions (assets/particles/*.json).
import { json } from '../core/assets.js';
import { DEG2RAD, clamp } from '../core/math.js';
import { gfx } from '../gfx/renderer.js';

const rnd = () => Math.random() * 2 - 1;

export class ParticleSystem {
  constructor(name) {
    this.particles = [];
    this.x = 0; this.y = 0;
    this.active = false;
    this.emitCounter = 0;
    this.elapsed = 0;
    this.colorOverride = null;
    this.angleOffset = 0;
    this.gravityScaleY = 1;
    this.scale = 1;
    const j = name ? json(`particles/${name}.json`) : null;
    const F = (k, d = 0) => (j && j[k] !== undefined ? +j[k] : d);
    this.duration = F('duration', -1);
    this.life = F('particleLifespan', 1);
    this.lifeVar = F('particleLifespanVariance');
    this.angle = F('angle');
    this.angleVar = F('angleVariance');
    this.speed = F('speed');
    this.speedVar = F('speedVariance');
    this.gx = F('gravityx');
    this.gy = F('gravityy');
    this.posVarX = F('sourcePositionVariancex');
    this.posVarY = F('sourcePositionVariancey');
    this.radial = F('radialAcceleration');
    this.radialVar = F('radialAccelVariance');
    this.tang = F('tangentialAcceleration');
    this.tangVar = F('tangentialAccelVariance');
    this.startSize = F('startParticleSize', 4);
    this.startSizeVar = F('startParticleSizeVariance');
    this.endSize = F('finishParticleSize', -1);
    this.endSizeVar = F('finishParticleSizeVariance');
    this.startSpin = F('rotationStart');
    this.startSpinVar = F('rotationStartVariance');
    this.endSpin = F('rotationEnd');
    this.endSpinVar = F('rotationEndVariance');
    this.startColor = [F('startColorRed', 1), F('startColorGreen', 1), F('startColorBlue', 1), F('startColorAlpha', 1)];
    this.startColorVar = [F('startColorVarianceRed'), F('startColorVarianceGreen'), F('startColorVarianceBlue'), F('startColorVarianceAlpha')];
    this.endColor = [F('finishColorRed', 1), F('finishColorGreen', 1), F('finishColorBlue', 1), F('finishColorAlpha')];
    this.endColorVar = [F('finishColorVarianceRed'), F('finishColorVarianceGreen'), F('finishColorVarianceBlue'), F('finishColorVarianceAlpha')];
    this.maxParticles = Math.max(1, F('maxParticles', 10));
    this.emitterType = F('emitterType');
    this.maxRadius = F('maxRadius');
    this.maxRadiusVar = F('maxRadiusVariance');
    this.minRadius = F('minRadius');
    this.rotPerSec = F('rotatePerSecond');
    this.rotPerSecVar = F('rotatePerSecondVariance');
    this.additive = F('blendFuncDestination') === 1;
    this.emissionRate = this.life > 0 ? this.maxParticles / this.life : this.maxParticles;
  }

  start() { this.active = true; this.elapsed = 0; }
  stop() { this.active = false; }
  reset() { this.particles.length = 0; this.emitCounter = 0; this.elapsed = 0; }
  burst() { this.active = false; for (let i = 0; i < this.maxParticles; i++) this.emit(); }
  get alive() { return this.active || this.particles.length > 0; }

  emit() {
    if (this.particles.length >= this.maxParticles) return;
    const s = this.scale;
    const life = Math.max(0.0001, this.life + this.lifeVar * rnd());
    const col = (base, v) => base.map((c, i) => clamp(c + v[i] * rnd(), 0, 1));
    let sc = col(this.startColor, this.startColorVar), ec = col(this.endColor, this.endColorVar);
    if (this.colorOverride) {
      const o = this.colorOverride;
      sc = [o[0], o[1], o[2], sc[3]];
      ec = [o[0], o[1], o[2], ec[3]];
    }
    const size = Math.max(0, this.startSize + this.startSizeVar * rnd()) * s;
    const endSize = this.endSize < 0 ? size : Math.max(0, this.endSize + this.endSizeVar * rnd()) * s;
    const rot = this.startSpin + this.startSpinVar * rnd();
    const a = (this.angle + this.angleOffset + this.angleVar * rnd()) * DEG2RAD;
    const p = {
      x: this.x + this.posVarX * rnd() * s, y: this.y + this.posVarY * rnd() * s, sx: this.x, sy: this.y,
      life, color: sc, dColor: sc.map((c, i) => (ec[i] - c) / life),
      size, dSize: (endSize - size) / life, rot, dRot: (this.endSpin + this.endSpinVar * rnd() - rot) / life,
    };
    if (this.emitterType === 0) {
      const sp = (this.speed + this.speedVar * rnd()) * s;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.radial = this.radial + this.radialVar * rnd();
      p.tang = this.tang + this.tangVar * rnd();
    } else {
      p.radius = (this.maxRadius + this.maxRadiusVar * rnd()) * s;
      p.dRadius = (this.minRadius * s - p.radius) / life;
      p.ang = a;
      p.degPerSec = (this.rotPerSec + this.rotPerSecVar * rnd()) * DEG2RAD;
    }
    this.particles.push(p);
  }

  update(dt) {
    if (this.active && this.emissionRate > 0) {
      const rate = 1 / this.emissionRate;
      this.emitCounter += dt;
      while (this.particles.length < this.maxParticles && this.emitCounter > rate) {
        this.emit();
        this.emitCounter -= rate;
      }
      if (this.emitCounter > rate) this.emitCounter %= rate;
      this.elapsed += dt;
      if (this.duration >= 0 && this.elapsed > this.duration) this.active = false;
    }
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      if (this.emitterType === 0) {
        const rx = p.x - p.sx, ry = p.y - p.sy, len = Math.hypot(rx, ry);
        const nx = len > 1e-4 ? rx / len : 0, ny = len > 1e-4 ? ry / len : 0;
        p.vx += (nx * p.radial - ny * p.tang + this.gx * this.scale) * dt;
        p.vy += (ny * p.radial + nx * p.tang + this.gy * this.gravityScaleY * this.scale) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      } else {
        p.ang += p.degPerSec * dt;
        p.radius += p.dRadius * dt;
        p.x = p.sx - Math.cos(p.ang) * p.radius;
        p.y = p.sy - Math.sin(p.ang) * p.radius;
      }
      for (let k = 0; k < 4; k++) p.color[k] += p.dColor[k] * dt;
      p.size = Math.max(0, p.size + p.dSize * dt);
      p.rot += p.dRot * dt;
    }
  }

  // ox, oy: world -> screen offset
  draw(ox, oy) {
    const r = gfx.r;
    for (const p of this.particles) {
      const h = p.size / 2, a = -p.rot * DEG2RAD, cs = Math.cos(a), sn = Math.sin(a);
      const cx = p.x + ox, cy = p.y + oy;
      const P = (x, y) => [cx + x * cs - y * sn, cy + x * sn + y * cs];
      r.drawPoly4([...P(-h, -h), ...P(h, -h), ...P(-h, h), ...P(h, h)], p.color, this.additive);
    }
  }
}
