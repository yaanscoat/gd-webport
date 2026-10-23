// Math helpers shared by the whole webport.
export const DEG2RAD = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// 2D affine transform [a c tx; b d ty]
export class Affine {
  constructor(a = 1, b = 0, c = 0, d = 1, tx = 0, ty = 0) {
    this.a = a; this.b = b; this.c = c; this.d = d; this.tx = tx; this.ty = ty;
  }
  applyX(x, y) { return this.a * x + this.c * y + this.tx; }
  applyY(x, y) { return this.b * x + this.d * y + this.ty; }
  apply(x, y) { return [this.applyX(x, y), this.applyY(x, y)]; }
  // this * o (o applied first)
  mul(o) {
    return new Affine(
      this.a * o.a + this.c * o.b, this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d, this.b * o.c + this.d * o.d,
      this.a * o.tx + this.c * o.ty + this.tx, this.b * o.tx + this.d * o.ty + this.ty);
  }
  // cocos-style node transform: translate * rotate(clockwise degrees) * scale
  static make(x, y, rotCW = 0, sx = 1, sy = 1) {
    const r = -rotCW * DEG2RAD;
    const cs = Math.cos(r), sn = Math.sin(r);
    return new Affine(cs * sx, sn * sx, -sn * sy, cs * sy, x, y);
  }
  static translate(x, y) { return new Affine(1, 0, 0, 1, x, y); }
}
export const IDENTITY = new Affine();

// Colors are [r, g, b, a] in 0..1
export const rgb = (r, g, b, a = 1) => [r / 255, g / 255, b / 255, a];
export const withAlpha = (c, a) => [c[0], c[1], c[2], a];
export const lerpColor = (x, y, t) => [lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t), lerp(x[3], y[3], t)];
export const WHITE = [1, 1, 1, 1];
export const BLACK = [0, 0, 0, 1];

export function applyHSV(c, hsv) {
  const [r, g, b] = c;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  let s = mx > 0 ? d / mx : 0, v = mx;
  h = (((h + hsv.h) % 360) + 360) % 360;
  s = clamp(hsv.sAbs ? s + hsv.s : s * hsv.s, 0, 1);
  v = clamp(hsv.vAbs ? v + hsv.v : v * hsv.v, 0, 1);
  const cc = v * s, x = cc * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - cc;
  let rr = 0, gg = 0, bb = 0;
  if (h < 60) { rr = cc; gg = x; } else if (h < 120) { rr = x; gg = cc; } else if (h < 180) { gg = cc; bb = x; }
  else if (h < 240) { gg = x; bb = cc; } else if (h < 300) { rr = x; bb = cc; } else { rr = cc; bb = x; }
  return [rr + m, gg + m, bb + m, c[3]];
}

export function parseHSV(s) {
  const v = [0, 1, 1, 0, 0];
  if (s) s.split('a').slice(0, 5).forEach((p, i) => { v[i] = parseFloat(p) || 0; });
  return { h: v[0], s: v[1], v: v[2], sAbs: !!v[3], vAbs: !!v[4] };
}

function bounceOut(t) {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
  if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
  t -= 2.625 / 2.75;
  return 7.5625 * t * t + 0.984375;
}
function elasticOut(t, period) {
  if (t === 0 || t === 1) return t;
  const s = period / 4;
  return Math.pow(2, -10 * t) * Math.sin(((t - s) * Math.PI * 2) / period) + 1;
}

// Easing curves used by move / rotate triggers
export function ease(type, t, rate) {
  t = clamp(t, 0, 1);
  if (!(rate > 0)) rate = 2;
  switch (type) {
    case 1: t *= 2; return t < 1 ? 0.5 * Math.pow(t, rate) : 1 - 0.5 * Math.pow(2 - t, rate);
    case 2: return Math.pow(t, rate);
    case 3: return Math.pow(t, 1 / rate);
    case 4: return t < 0.5 ? 0.5 * (1 - elasticOut(1 - t * 2, rate)) : 0.5 * elasticOut(t * 2 - 1, rate) + 0.5;
    case 5: return 1 - elasticOut(1 - t, rate);
    case 6: return elasticOut(t, rate);
    case 7: return t < 0.5 ? (1 - bounceOut(1 - t * 2)) * 0.5 : bounceOut(t * 2 - 1) * 0.5 + 0.5;
    case 8: return 1 - bounceOut(1 - t);
    case 9: return bounceOut(t);
    case 10:
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? 0.5 * Math.pow(2, 10 * (t * 2 - 1)) : 0.5 * (-Math.pow(2, -10 * (t * 2 - 1)) + 2);
    case 11: return t === 0 ? 0 : Math.pow(2, 10 * (t - 1)) - 0.001;
    case 12: return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 13: return -0.5 * (Math.cos(Math.PI * t) - 1);
    case 14: return 1 - Math.cos((t * Math.PI) / 2);
    case 15: return Math.sin((t * Math.PI) / 2);
    case 16: {
      const o = 1.70158 * 1.525;
      t *= 2;
      if (t < 1) return (t * t * ((o + 1) * t - o)) / 2;
      t -= 2;
      return (t * t * ((o + 1) * t + o)) / 2 + 1;
    }
    case 17: { const o = 1.70158; return t * t * ((o + 1) * t - o); }
    case 18: { const o = 1.70158; t -= 1; return t * t * ((o + 1) * t + o) + 1; }
    default: return t;
  }
}

export class Rect {
  constructor(x = 0, y = 0, w = 0, h = 0) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get minX() { return this.x; }
  get maxX() { return this.x + this.w; }
  get minY() { return this.y; }
  get maxY() { return this.y + this.h; }
  intersects(o) { return this.x < o.x + o.w && o.x < this.x + this.w && this.y < o.y + o.h && o.y < this.y + this.h; }
  contains(px, py) { return px >= this.x && px <= this.x + this.w && py >= this.y && py <= this.y + this.h; }
  static centered(cx, cy, w, h) { return new Rect(cx - w / 2, cy - h / 2, w, h); }
}
