// Converts the original game's Resources folder into web-ready assets.
// Usage: node tools/prepare-assets.mjs [path/to/Resources] [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(here, '..');
const src = path.resolve(process.argv[2] ?? path.join(project, '..', 'legacy', 'Resources'));
const out = path.resolve(process.argv[3] ?? path.join(project, 'assets'));
const Q = 'hd'; // texture quality suffix: '' | 'hd' | 'uhd'
const SCALE = { '': 1, hd: 2, uhd: 4 }[Q];
const sfx = Q ? `-${Q}` : '';

if (!fs.existsSync(src)) { console.error(`Resources folder not found: ${src}`); process.exit(1); }

// ---------- minimal XML plist parser ----------
function parsePlist(xml) {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|string|integer|real|true|false)(\s*\/)?>([^<]*)/g)];
  let i = 0;
  function value() {
    const [, close, tag, selfClose, text] = tokens[i++];
    if (close) throw new Error('unexpected close tag ' + tag);
    switch (tag) {
      case 'dict': {
        const o = {};
        if (selfClose) return o;
        while (!(tokens[i][1] && tokens[i][2] === 'dict')) {
          const k = tokens[i++]; // <key>
          if (k[2] !== 'key') throw new Error('expected key');
          i++; // </key>
          o[decode(k[4])] = value();
        }
        i++;
        return o;
      }
      case 'array': {
        const a = [];
        if (selfClose) return a;
        while (!(tokens[i][1] && tokens[i][2] === 'array')) a.push(value());
        i++;
        return a;
      }
      case 'true': return true;
      case 'false': return false;
      case 'string': if (selfClose) return ''; i++; return decode(text);
      case 'integer': case 'real': i++; return Number(text);
    }
    throw new Error('bad tag ' + tag);
  }
  const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  while (tokens[i][2] !== 'dict') i++;
  return value();
}
const nums = (s) => (String(s).match(/-?[\d.]+(e-?\d+)?/g) || []).map(Number);

// ---------- helpers ----------
const mkdir = (d) => fs.mkdirSync(d, { recursive: true });
const copy = (from, to) => { mkdir(path.dirname(to)); fs.copyFileSync(from, to); };
const R = (...p) => path.join(src, ...p);
const O = (...p) => path.join(out, ...p);
mkdir(out);
const manifest = { text: [], images: [], scale: SCALE };

// ---------- sprite atlases ----------
const atlas = { sheets: [], frames: {} };
function addSheet(plistPath, pngRel) {
  const pl = parsePlist(fs.readFileSync(plistPath, 'utf8'));
  const sheetIdx = atlas.sheets.length;
  atlas.sheets.push(pngRel);
  for (const [name, f] of Object.entries(pl.frames)) {
    if (atlas.frames[name]) continue;
    const [x, y, w, h] = nums(f.textureRect ?? f.frame);
    const [ox, oy] = nums(f.spriteOffset ?? f.offset ?? '{0,0}');
    const [sw, sh] = nums(f.spriteSourceSize ?? f.sourceSize);
    atlas.frames[name] = [sheetIdx, x, y, w, h, (f.textureRotated ?? f.rotated) ? 1 : 0, ox, oy, sw, sh];
  }
}
const SHEETS = ['GJ_GameSheet', 'GJ_GameSheet02', 'GJ_GameSheet03', 'GJ_GameSheet04', 'GJ_GameSheetGlow',
  'GJ_GameSheetIcons', 'GJ_LaunchSheet', 'GJ_ParticleSheet', 'FireSheet_01', 'PixelSheet_01'];
for (const s of SHEETS) {
  const png = `${s}${sfx}.png`;
  addSheet(R(`${s}${sfx}.plist`), `sheets/${png}`);
  copy(R(png), O('sheets', png));
}
// player icons: one small sheet per icon, loaded lazily by the engine
for (const f of fs.readdirSync(R('icons')).filter((f) => f.endsWith(`${sfx}.plist`) && (Q !== '' || !/-u?hd\./.test(f)))) {
  const png = f.replace(/\.plist$/, '.png');
  addSheet(R('icons', f), `icons/${png}`);
  copy(R('icons', png), O('icons', png));
}
fs.writeFileSync(O('atlas.json'), JSON.stringify(atlas));
manifest.text.push('atlas.json');
console.log(`atlas: ${atlas.sheets.length} sheets, ${Object.keys(atlas.frames).length} frames`);

// ---------- loose textures (backgrounds, grounds, UI) ----------
let loose = 0;
for (const f of fs.readdirSync(src)) {
  if (!f.endsWith(`${sfx}.png`) || (Q === 'hd' && f.endsWith('-uhd.png'))) continue;
  const base = f.slice(0, -(`${sfx}.png`).length);
  if (SHEETS.includes(base) || /Sheet|Font|font|PlayerExplosion|dialogIcon|Skull|promo|tutorial/.test(base)) continue;
  copy(R(f), O('tex', `${base}.png`));
  loose++;
}
console.log(`loose textures: ${loose}`);

// ---------- bitmap fonts ----------
for (const font of ['bigFont', 'goldFont', 'chatFont']) {
  const fnt = fs.readFileSync(R(`${font}${sfx}.fnt`), 'utf8').replace(/file="[^"]*"/, `file="${font}.png"`);
  mkdir(O('fonts'));
  fs.writeFileSync(O('fonts', `${font}.fnt`), fnt);
  copy(R(`${font}${sfx}.png`), O('fonts', `${font}.png`));
  manifest.text.push(`fonts/${font}.fnt`);
}

// ---------- particle systems ----------
mkdir(O('particles'));
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.plist') && !/-u?hd\.plist$/.test(f))) {
  const xml = fs.readFileSync(R(f), 'utf8');
  if (!xml.includes('<key>emitterType</key>')) continue;
  const p = parsePlist(xml);
  delete p.textureImageData;
  const name = f.replace(/\.plist$/, '.json');
  fs.writeFileSync(O('particles', name), JSON.stringify(p));
  manifest.text.push(`particles/${name}`);
}

// ---------- robot / spider part animations ----------
const anims = {};
for (const kind of ['Robot', 'Spider']) {
  const pl = parsePlist(fs.readFileSync(R(`${kind}_AnimDesc.plist`), 'utf8'));
  const byAnim = {};
  for (const frameName of Object.keys(pl.animationContainer).sort()) {
    const m = frameName.match(/^[A-Za-z]+_(.+)_(\d+)\.png$/);
    if (!m) continue;
    const sprites = Object.values(pl.animationContainer[frameName]).map((s) => {
      const [x, y] = nums(s.position);
      const [sx, sy] = nums(s.scale);
      const [fx, fy] = nums(s.flipped);
      return { p: Number(s.texture.match(/_(\d\d)_001\.png$/)[1]), x, y, sx, sy, r: Number(s.rotation), fx, fy, z: Number(s.zValue) };
    });
    (byAnim[m[1]] ??= []).push(sprites);
  }
  anims[kind.toLowerCase()] = byAnim;
}
fs.writeFileSync(O('anims.json'), JSON.stringify(anims));
manifest.text.push('anims.json');

// ---------- audio ----------
for (const f of fs.readdirSync(src)) {
  if (f.endsWith('.mp3')) copy(R(f), O('music', f));
  else if (f.endsWith('.ogg')) copy(R(f), O('sfx', f));
}

// ---------- levels & game data ----------
for (const f of fs.readdirSync(R('levels'))) {
  copy(R('levels', f), O('levels', f));
  manifest.text.push(`levels/${f}`);
}
for (const f of ['objects.json', 'levels.json']) {
  copy(path.join(project, 'data', f), O(f));
  manifest.text.push(f);
}

// textures the loader decodes before the game starts
manifest.images = ['sheets/GJ_GameSheet', 'sheets/GJ_GameSheet02', 'sheets/GJ_GameSheet03', 'sheets/GJ_GameSheet04',
  'sheets/GJ_GameSheetGlow', 'sheets/GJ_LaunchSheet', 'sheets/GJ_GameSheetIcons']
  .map((s) => `${s}${sfx}.png`)
  .concat(['fonts/bigFont.png', 'fonts/goldFont.png', 'fonts/chatFont.png']);
fs.writeFileSync(O('manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`manifest: ${manifest.text.length} text files, ${manifest.images.length} preloaded images`);
