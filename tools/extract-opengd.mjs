// One-off: derive data/objects.json from an OpenGD checkout (GPL-3.0 data).
// Usage: node tools/extract-opengd.mjs <path-to-OpenGD>
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) { console.error('usage: extract-opengd.mjs <OpenGD dir>'); process.exit(1); }
const objs = JSON.parse(fs.readFileSync(path.join(root, 'Content/Custom/object.json'), 'utf8'));
const longData = fs.readFileSync(path.join(root, 'Source/LongData.cpp'), 'utf8');

const block = (startMarker) => {
  const s = longData.indexOf(startMarker);
  const e = longData.indexOf('};', s);
  return longData.slice(s, e);
};
const hitboxes = {};
for (const m of block('GameObject::_pHitboxes =').matchAll(/\{(\d+),\s*\{([^}]*)\}\}/g)) {
  const [h, w, x, y] = m[2].split(',').map(Number);
  hitboxes[m[1]] = [w, h, x, y];
}
const radius = {};
for (const m of block('GameObject::_pHitboxRadius =').matchAll(/\{(\d+),\s*([\d.]+)\}/g)) radius[m[1]] = Number(m[2]);

const CC = { base: 1, detail: 2, black: 3 };
const r3 = (v) => Math.round(v * 1000) / 1000;
const child = (c) => {
  const o = { t: c.texture_name, x: r3(c.x), y: r3(c.y) };
  if (c.anchor_x !== 0.5 || c.anchor_y !== 0.5) o.a = [r3(c.anchor_x), r3(c.anchor_y)];
  if (c.scale_x !== 1 || c.scale_y !== 1) o.s = [r3(c.scale_x), r3(c.scale_y)];
  if (c.rot) o.r = r3(c.rot);
  if (c.flip_x) o.fx = 1;
  if (c.flip_y) o.fy = 1;
  if (c.z) o.z = c.z;
  o.cc = CC[c.color_channel] ?? 0;
  if (c.r !== 255 || c.g !== 255 || c.b !== 255) o.col = [c.r, c.g, c.b];
  if (c.children?.length) o.ch = c.children.map(child);
  return o;
};

const out = {};
for (const [id, v] of Object.entries(objs)) {
  const o = { t: v.texture_name, ty: v.object_type, z: v.default_z_layer, zo: v.default_z_order };
  if (v.default_primary_channel) o.c1 = v.default_primary_channel;
  if (v.default_secondary_channel > 0) o.c2 = v.default_secondary_channel;
  o.cc = CC[v.color_channel] ?? 0;
  if (v.children?.length) o.ch = v.children.map(child);
  if (hitboxes[id]) o.hb = hitboxes[id];
  if (radius[id]) o.rad = radius[id];
  out[id] = o;
}
fs.writeFileSync(new URL('../data/objects.json', import.meta.url), JSON.stringify(out));
console.log('objects:', Object.keys(out).length, 'hitboxes:', Object.keys(hitboxes).length, 'radius:', Object.keys(radius).length);
