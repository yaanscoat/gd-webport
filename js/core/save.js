// Player progress and settings, persisted in localStorage.
import { rgb } from './math.js';

const KEY = 'gdweb:save';

export const save = {
  levels: {}, // id -> {normal, practice, attempts, jumps, coins, completed}
  icons: [1, 1, 1, 1, 1, 1, 1, 1], // cube ship ball ufo wave robot spider swing
  color1: 0,
  color2: 3,
  glow: false,
  musicVolume: 1,
  sfxVolume: 1,
  totalAttempts: 0,
  totalJumps: 0,
  showPercent: true,
};

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(save, JSON.parse(raw));
  } catch { /* storage unavailable or corrupt: keep defaults */ }
}

export function writeSave() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* storage unavailable */ }
}

export function levelProgress(id) {
  return (save.levels[id] ??= { normal: 0, practice: 0, attempts: 0, jumps: 0, coins: 0, completed: false });
}

// GD player color palette
const PALETTE = [
  [125, 255, 0], [0, 255, 0], [0, 255, 125], [0, 255, 255], [0, 125, 255], [0, 0, 255],
  [125, 0, 255], [255, 0, 255], [255, 0, 125], [255, 0, 0], [255, 125, 0], [255, 255, 0],
  [255, 255, 255], [185, 0, 255], [255, 185, 0], [0, 0, 0], [0, 200, 255], [175, 175, 175],
  [90, 90, 90], [255, 125, 125], [0, 175, 75], [0, 125, 125], [0, 75, 175], [75, 0, 175],
  [125, 0, 125], [175, 0, 75], [175, 75, 0], [125, 125, 0], [75, 175, 0], [255, 75, 0],
  [150, 50, 0], [150, 100, 0], [150, 150, 0], [0, 150, 0], [0, 150, 150], [0, 100, 150],
  [100, 0, 150], [150, 0, 100], [150, 0, 0], [0, 150, 100], [125, 255, 175], [125, 125, 255],
];
export const paletteSize = PALETTE.length;
export const paletteColor = (i) => rgb(...(PALETTE[i] ?? PALETTE[0]));
