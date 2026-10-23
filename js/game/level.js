// Level string decoding (base64url + gzip) and parsing of the header and objects.
import { rgb, parseHSV } from '../core/math.js';

export async function decodeLevelString(encoded) {
  // base64url; drop whitespace, padding and stray characters before decoding
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '');
  const bin = atob(b64.slice(0, b64.length - (b64.length % 4 === 1 ? 1 : 0)) + '='.repeat((4 - (b64.length % 4)) % 4 % 3));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const format = bytes[0] === 0x1f && bytes[1] === 0x8b ? 'gzip' : 'deflate';
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
  return new Response(stream).text();
}

// Splits "k,v,k,v" into an object keyed by number.
function kv(str, sep) {
  const parts = str.split(sep);
  const o = {};
  for (let i = 0; i + 1 < parts.length; i += 2) o[parts[i]] = parts[i + 1];
  return o;
}

function parseColorString(s) {
  const c = kv(s, '_');
  return {
    channel: +c[6] || 0,
    color: rgb(+(c[1] ?? 255), +(c[2] ?? 255), +(c[3] ?? 255), c[7] !== undefined ? +c[7] : 1),
    player: Math.max(0, +c[4] || 0),
    blending: c[5] === '1',
    copyFrom: +c[9] || 0,
    hsv: parseHSV(c[10]),
  };
}

const LEGACY_KEYS = { kS29: 1000, kS30: 1001, kS31: 1002, kS32: 1004, kS33: 1, kS34: 2, kS35: 3, kS36: 4, kS37: 1003 };

export function parseSettings(header) {
  const h = kv(header, ',');
  const st = {
    gamemode: +h.kA2 || 0, mini: h.kA3 === '1', speed: +h.kA4 || 0,
    background: Math.max(1, +h.kA6 || 1), ground: Math.max(1, +h.kA7 || 1), groundLine: Math.max(1, +h.kA17 || 1),
    middleground: +h.kA25 || 0, dual: h.kA8 === '1', flipGravity: h.kA11 === '1',
    songOffset: parseFloat(h.kA13) || 0, fadeIn: h.kA15 === '1', fadeOut: h.kA16 === '1',
    colors: [],
  };
  if (h.kS1 !== undefined) st.colors.push({ channel: 1000, color: rgb(+h.kS1, +h.kS2, +h.kS3), player: 0, blending: false, copyFrom: 0 });
  if (h.kS4 !== undefined) st.colors.push({ channel: 1001, color: rgb(+h.kS4, +h.kS5, +h.kS6), player: 0, blending: false, copyFrom: 0 });
  for (const [key, ch] of Object.entries(LEGACY_KEYS)) {
    if (h[key] === undefined) continue;
    const c = parseColorString(h[key]);
    c.channel = ch;
    st.colors.push(c);
  }
  if (h.kS38) {
    for (const part of h.kS38.split('|')) {
      if (!part) continue;
      const c = parseColorString(part);
      if (c.channel > 0) st.colors.push(c);
    }
  }
  return st;
}

export async function parseLevel(raw) {
  raw = raw.trim();
  const data = raw.startsWith('H4sI') || raw.startsWith('eJ') ? await decodeLevelString(raw) : raw;
  const parts = data.split(';');
  const settings = parseSettings(parts[0]);
  const objects = [];
  for (let i = 1; i < parts.length; i++) if (parts[i]) objects.push(kv(parts[i], ','));
  return { settings, objects };
}
