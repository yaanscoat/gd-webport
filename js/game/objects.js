// Object definitions (textures, child sprites, color slots, z-layers, hitboxes) built from assets/objects.json.
import { Affine } from '../core/math.js';
import { gfx } from '../gfx/renderer.js';

export const OT = {
  Solid: 0, Hazard: 2, GravityUpPortal: 3, GravityDownPortal: 4, ShipPortal: 5, CubePortal: 6, Decoration: 7,
  YellowPad: 8, PinkPad: 9, GravityPad: 10, YellowRing: 11, PinkRing: 12, GravityRing: 13, MirrorPortal: 14,
  UnmirrorPortal: 15, BallPortal: 16, NormalSizePortal: 17, MiniPortal: 18, UfoPortal: 19, Modifier: 20,
  SecretCoin: 22, DualPortal: 23, SoloPortal: 24, Slope: 25, WavePortal: 26, RobotPortal: 27, TeleportPortal: 28,
  GreenRing: 29, Collectible: 30, UserCoin: 31, DropRing: 32, SpiderPortal: 33, RedPad: 34, RedRing: 35,
  CustomRing: 36, DashRing: 37, GravityDashRing: 38, CollisionObject: 39, Special: 40,
};

export const SLOT = { Fixed: 0, Base: 1, Detail: 2, Black: 3 };

// Flattens a node and its children into draw parts in cocos draw order
// (negative-z children, then the node, then the remaining children).
function flatten(node, parentM, parentContent, def, isRoot) {
  const r = gfx.r;
  const f = r.frame(node.t);
  const cw = f ? f.sw : 0, ch = f ? f.sh : 0;
  let m = parentM, ax = 0.5, ay = 0.5;
  if (!isRoot) {
    if (node.a) [ax, ay] = node.a;
    let sx = node.s ? node.s[0] : 1, sy = node.s ? node.s[1] : 1;
    if (node.fx) sx = -sx;
    if (node.fy) sy = -sy;
    // child positions are relative to the parent's bottom-left content corner
    m = parentM.mul(Affine.make(node.x - parentContent[0] * 0.5, node.y - parentContent[1] * 0.5, node.r || 0, sx, sy));
  }
  const center = m.mul(Affine.translate(cw * (0.5 - ax), ch * (0.5 - ay)));
  const kids = (node.ch || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
  for (const k of kids) if ((k.z || 0) < 0) flatten(k, center, [cw, ch], def, false);
  if (f) {
    const slot = node.cc ?? 0;
    const part = { frame: f, local: center, slot, fixed: [1, 1, 1, 1] };
    if (node.col) part.fixed = [node.col[0] / 255, node.col[1] / 255, node.col[2] / 255, 1];
    if (slot === SLOT.Black) part.fixed = [0, 0, 0, 1];
    if (slot === SLOT.Base) def.hasBase = true;
    if (slot === SLOT.Detail) def.hasDetail = true;
    def.parts.push(part);
  }
  for (const k of kids) if ((k.z || 0) >= 0) flatten(k, center, [cw, ch], def, false);
}

const defs = new Map();

export function loadObjectDefs(json) {
  const r = gfx.r;
  for (const [key, o] of Object.entries(json)) {
    const id = +key;
    const def = {
      id, type: o.ty, zLayer: o.z ?? 5, zOrder: o.zo ?? 0, c1: o.c1 || 0, c2: o.c2 || 0,
      parts: [], hasBase: false, hasDetail: false,
      hitbox: o.hb || null, radius: o.rad || 0, backFrame: null, extent: 15,
    };
    flatten(o, new Affine(), [0, 0], def, true);
    if (o.t && o.t.includes('_front_')) def.backFrame = r.frame(o.t.replace('_front_', '_back_')) || null;
    for (const p of def.parts) {
      def.extent = Math.max(def.extent, Math.max(p.frame.sw, p.frame.sh) * 0.5 + Math.max(Math.abs(p.local.tx), Math.abs(p.local.ty)));
    }
    defs.set(id, def);
  }
}

export const objectDef = (id) => defs.get(id);
