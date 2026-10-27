'use strict';
// SVG previews for hovers: object sprites and whole levels.

const { resolveGlyph } = require('./model');

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

/** Draw a sprite (matrix of color indexes, -1 = transparent) into SVG rects. */
function spriteRects(obj, x0, y0, cell) {
  if (!obj) return '';
  const colors = obj.colors || [];
  const sprite = obj.sprite && obj.sprite.length ? obj.sprite : null;
  if (!sprite) {
    const c = colors[0];
    if (!c || c === 'transparent') return '';
    return `<rect x="${x0}" y="${y0}" width="${cell}" height="${cell}" fill="${esc(c)}"/>`;
  }
  const h = sprite.length;
  const w = Math.max(...sprite.map((r) => r.length));
  const px = cell / Math.max(w, h);
  let out = '';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      const idx = sprite[y][x];
      if (idx < 0) continue;
      const c = colors[idx];
      if (!c || c === 'transparent') continue;
      out += `<rect x="${(x0 + x * px).toFixed(2)}" y="${(y0 + y * px).toFixed(2)}" width="${(px + 0.05).toFixed(2)}" height="${(px + 0.05).toFixed(2)}" fill="${esc(c)}"/>`;
    }
  }
  return out;
}

function svgDataUri(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function spriteSvg(obj, size) {
  size = size || 80;
  const checker = `<rect width="${size}" height="${size}" fill="#2a2a2a"/>`;
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${checker}${spriteRects(obj, 0, 0, size)}</svg>`);
}

/** Expand a collision-layer entry (object, alias or property) into object names. */
function expandAll(model, name, seen) {
  seen = seen || new Set();
  const k = name.toLowerCase();
  if (seen.has(k)) return [];
  seen.add(k);
  const d = model.defs.get(k);
  if (!d) return [];
  if (d.kind === 'object' || d.kind === 'alias') return [d.target.name.toLowerCase()];
  return d.target.items.flatMap((it) => expandAll(model, it, seen));
}

/**
 * Render a level map to SVG using the compiled objects (colors/sprites) and the
 * document's legend + collision layers for glyph resolution and draw order.
 */
function levelSvg(model, level, compiledObjects, maxPx) {
  maxPx = maxPx || 360;
  const rows = level.rows;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => [...r].length));
  const cell = Math.max(6, Math.min(32, Math.floor(maxPx / Math.max(w, h))));

  const layerOf = new Map();
  model.layers.forEach((layer, li) => {
    for (const n of layer) for (const o of expandAll(model, n)) if (!layerOf.has(o)) layerOf.set(o, li);
  });
  const bg = resolveGlyph(model, 'background');
  const objs = compiledObjects || {};

  let body = '';
  for (let y = 0; y < h; y++) {
    const chars = [...rows[y]];
    for (let x = 0; x < w; x++) {
      const ch = chars[x];
      const names = ch ? resolveGlyph(model, ch) : [];
      const all = [...new Set([...bg, ...names])].sort((a, b) => (layerOf.get(a) ?? 0) - (layerOf.get(b) ?? 0));
      for (const n of all) body += spriteRects(objs[n], x * cell, y * cell, cell);
    }
  }
  const W = w * cell, H = h * cell;
  return svgDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><rect width="${W}" height="${H}" fill="#000"/>${body}</svg>`);
}

module.exports = { spriteSvg, levelSvg };
