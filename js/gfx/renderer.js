// Batched WebGL2 sprite renderer. Textures are premultiplied; additive sprites
// output alpha 0 so normal and additive quads share one blend mode and one batch.
import { BASE } from '../core/assets.js';
import { Affine, clamp } from '../core/math.js';

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in vec4 aColor;
uniform vec4 uProj;
out vec2 vUV;
out vec4 vColor;
void main() {
  vUV = aUV;
  vColor = aColor;
  gl_Position = vec4(aPos * uProj.xy + uProj.zw, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec4 vColor;
uniform sampler2D uTex;
out vec4 frag;
void main() { frag = texture(uTex, vUV) * vColor; }`;

const MAX_QUADS = 8192;
const FLOATS_PER_VERT = 5;

export class Texture {
  constructor() { this.gl = null; this.w = 0; this.h = 0; this.state = 0; this.path = null; }
  get ready() { return this.state === 1; }
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.contentScale = 2; // -hd textures are 2x the game's point size
    this.textures = new Map();
    this.frames = new Map();
    this.images = new Map();
    this.drawCalls = 0;

    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    this.prog = prog;
    this.uProj = gl.getUniformLocation(prog, 'uProj');

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_QUADS * 4 * FLOATS_PER_VERT * 4, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERT * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, stride, 16);
    const idx = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0, v = 0; i < idx.length; i += 6, v += 4) {
      idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2;
      idx[i + 3] = v + 2; idx[i + 4] = v + 1; idx[i + 5] = v + 3;
    }
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.buf = new ArrayBuffer(MAX_QUADS * 4 * FLOATS_PER_VERT * 4);
    this.f32 = new Float32Array(this.buf);
    this.u32 = new Uint32Array(this.buf);
    this.quads = 0;
    this.curTex = null;

    this.white = new Texture();
    this.uploadPixels(this.white, new ImageData(new Uint8ClampedArray([255, 255, 255, 255]), 1, 1));
  }

  // ---------------------------------------------------------------- textures
  uploadPixels(tex, img) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    tex.gl = t;
    tex.w = img.width;
    tex.h = img.height;
    tex.state = 1;
    this.curTex = null;
  }

  // Lazily loads a texture from assets/<path>; returns immediately (draws are skipped until ready).
  texture(path) {
    let t = this.textures.get(path);
    if (t) {
      if (t.state === -2) this.startLoad(t);
      return t;
    }
    t = new Texture();
    t.path = path;
    this.textures.set(path, t);
    this.startLoad(t);
    return t;
  }

  startLoad(t) {
    t.state = 0;
    const img = new Image();
    img.decoding = 'async';
    img.src = BASE + t.path;
    t.promise = img.decode().then(() => this.uploadPixels(t, img)).catch(() => {
      console.warn('[gd] texture failed:', t.path);
      t.state = -1;
    });
  }

  whenReady(paths) {
    return Promise.all(paths.map((p) => this.texture(p).promise));
  }

  loadAtlas(atlas) {
    const cs = this.contentScale;
    const sheets = atlas.sheets.map((path) => {
      let t = this.textures.get(path);
      if (!t) {
        t = new Texture();
        t.path = path;
        t.state = -2; // deferred until a frame from this sheet is used
        this.textures.set(path, t);
      }
      return t;
    });
    for (const name in atlas.frames) {
      const a = atlas.frames[name];
      this.frames.set(name, {
        tex: sheets[a[0]], tx: a[1], ty: a[2], tw: a[3], th: a[4], rotated: a[5] === 1,
        ox: a[6] / cs, oy: a[7] / cs, w: a[3] / cs, h: a[4] / cs, sw: a[8] / cs, sh: a[9] / cs,
      });
    }
  }

  // Sprite frame from the atlas (sheet textures load on first use)
  frame(name) {
    const f = this.frames.get(name);
    if (f && f.tex.state === -2) this.startLoad(f.tex);
    return f;
  }

  // A whole loose image (assets/tex/...) as a sprite frame
  image(path) {
    let f = this.images.get(path);
    if (!f) {
      f = { tex: this.texture(path), tx: 0, ty: 0, tw: 0, th: 0, rotated: false, ox: 0, oy: 0, w: 0, h: 0, sw: 0, sh: 0 };
      this.images.set(path, f);
    }
    if (f.tw === 0 && f.tex.ready) {
      const cs = this.contentScale;
      f.tw = f.tex.w; f.th = f.tex.h;
      f.w = f.sw = f.tex.w / cs;
      f.h = f.sh = f.tex.h / cs;
    }
    return f;
  }

  // ---------------------------------------------------------------- frame
  begin(pixelW, pixelH, viewX, viewY, viewW, viewH, W, H) {
    const gl = this.gl;
    this.W = W;
    this.H = H;
    this.drawCalls = 0;
    gl.viewport(0, 0, pixelW, pixelH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.viewport(viewX, viewY, viewW, viewH);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.uniform4f(this.uProj, 2 / W, 2 / H, -1, -1);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    this.curTex = null;
    this.quads = 0;
  }

  flush() {
    if (this.quads === 0 || !this.curTex) { this.quads = 0; return; }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.curTex.gl);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.f32, 0, this.quads * 4 * FLOATS_PER_VERT);
    gl.drawElements(gl.TRIANGLES, this.quads * 6, gl.UNSIGNED_SHORT, 0);
    this.drawCalls++;
    this.quads = 0;
  }

  pack(c, additive) {
    const a = clamp(c[3], 0, 1);
    const b = (v) => (clamp(v, 0, 1) * 255 + 0.5) | 0;
    return (b(c[0] * a) | (b(c[1] * a) << 8) | (b(c[2] * a) << 16) | ((additive ? 0 : b(a)) << 24)) >>> 0;
  }

  // positions/uvs: bl, br, tl, tr
  quad(tex, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, u2, v2, u3, v3, color) {
    if (tex !== this.curTex || this.quads >= MAX_QUADS) {
      this.flush();
      this.curTex = tex;
    }
    const f = this.f32, u = this.u32;
    let o = this.quads * 4 * FLOATS_PER_VERT;
    f[o] = x0; f[o + 1] = y0; f[o + 2] = u0; f[o + 3] = v0; u[o + 4] = color; o += 5;
    f[o] = x1; f[o + 1] = y1; f[o + 2] = u1; f[o + 3] = v1; u[o + 4] = color; o += 5;
    f[o] = x2; f[o + 1] = y2; f[o + 2] = u2; f[o + 3] = v2; u[o + 4] = color; o += 5;
    f[o] = x3; f[o + 1] = y3; f[o + 2] = u3; f[o + 3] = v3; u[o + 4] = color;
    this.quads++;
  }

  // Draws the (u0..u1, v0..v1) part of a frame; m maps the trimmed rect (bottom-left origin, points) to screen.
  drawFramePart(f, m, c, u0, v0, u1, v1, additive = false) {
    if (!f || !f.tex.ready || f.tw === 0 || c[3] <= 0.002) return;
    const t = f.tex, w = f.w, h = f.h;
    const iw = 1 / t.w, ih = 1 / t.h;
    const px = (x, y) => m.a * x + m.c * y + m.tx, py = (x, y) => m.b * x + m.d * y + m.ty;
    const ax = w * u0, bx = w * u1, ay = h * v0, by = h * v1;
    let uv;
    if (!f.rotated) {
      const l = f.tx * iw, r = (f.tx + f.tw) * iw, top = f.ty * ih, bot = (f.ty + f.th) * ih;
      const U = (q) => l + (r - l) * q, V = (q) => bot + (top - bot) * q;
      uv = [U(u0), V(v0), U(u1), V(v0), U(u0), V(v1), U(u1), V(v1)];
    } else {
      // stored rotated 90deg clockwise in the sheet (cocos convention)
      const l = f.tx * iw, r = (f.tx + f.th) * iw, top = f.ty * ih, bot = (f.ty + f.tw) * ih;
      const P = (uu, vv) => [l + (r - l) * vv, top + (bot - top) * uu];
      uv = [...P(u0, v0), ...P(u1, v0), ...P(u0, v1), ...P(u1, v1)];
    }
    this.quad(t, px(ax, ay), py(ax, ay), px(bx, ay), py(bx, ay), px(ax, by), py(ax, by), px(bx, by), py(bx, by),
      uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[6], uv[7], this.pack(c, additive));
  }

  // Draws a frame with its anchor (default center of the untrimmed box) at the transform origin.
  drawFrame(f, m, c, additive = false, ax = 0.5, ay = 0.5) {
    if (!f) return;
    const sw = f.sw || f.w, sh = f.sh || f.h;
    const ox = sw * 0.5 + f.ox - f.w * 0.5 - sw * ax;
    const oy = sh * 0.5 + f.oy - f.h * 0.5 - sh * ay;
    this.drawFramePart(f, new Affine(m.a, m.b, m.c, m.d, m.a * ox + m.c * oy + m.tx, m.b * ox + m.d * oy + m.ty), c, 0, 0, 1, 1, additive);
  }

  drawRect(x, y, w, h, c) {
    const col = this.pack(c, false);
    this.quad(this.white, x, y, x + w, y, x, y + h, x + w, y + h, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, col);
  }

  drawPoly4(p, c, additive = false) {
    this.quad(this.white, p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, this.pack(c, additive));
  }

  drawCircle(cx, cy, r, c, seg = 32) {
    const col = this.pack(c, false);
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      this.quad(this.white, cx, cy, x0, y0, cx, cy, x1, y1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, col);
    }
  }

  drawRing(cx, cy, r, thick, c, seg = 48) {
    const col = this.pack(c, false);
    const r0 = Math.max(0, r - thick / 2), r1 = r + thick / 2;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      this.quad(this.white, cx + c0 * r0, cy + s0 * r0, cx + c0 * r1, cy + s0 * r1, cx + c1 * r0, cy + s1 * r0, cx + c1 * r1, cy + s1 * r1,
        0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, col);
    }
  }

  drawTexQuad(tex, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, u2, v2, u3, v3, c, additive = false) {
    if (!tex.ready) return;
    this.quad(tex, x0, y0, x1, y1, x2, y2, x3, y3, u0, v0, u1, v1, u2, v2, u3, v3, this.pack(c, additive));
  }
}

// Shared renderer instance (set by main.js)
export const gfx = { r: null };
