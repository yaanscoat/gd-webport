// Loads the converted game assets from the assets/ folder (relative URLs, so it works on any static host).
export const BASE = new URL('../../assets/', import.meta.url).href;

const textCache = new Map();
const jsonCache = new Map();

export async function fetchText(path) {
  if (textCache.has(path)) return textCache.get(path);
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  const text = await res.text();
  textCache.set(path, text);
  return text;
}

export async function fetchJSON(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  const json = JSON.parse(await fetchText(path));
  jsonCache.set(path, json);
  return json;
}

// Synchronous access to files that were preloaded by preloadText()
export function text(path) { return textCache.get(path); }
export function json(path) {
  if (!jsonCache.has(path) && textCache.has(path)) jsonCache.set(path, JSON.parse(textCache.get(path)));
  return jsonCache.get(path);
}

export async function preloadText(paths, onProgress) {
  let done = 0;
  await Promise.all(paths.map(async (p) => {
    await fetchText(p);
    onProgress?.(++done, paths.length);
  }));
}
