'use strict';
// Lightweight, error-tolerant PuzzleScript document model used by the editor
// features (completion, hover, go-to-definition, outline...). It does not try to
// validate anything: the official compiler (engine-node) does that.

const SECTIONS = ['objects', 'legend', 'sounds', 'collisionlayers', 'rules', 'winconditions', 'levels'];

/** Replace comments (nested parentheses, may span lines) with spaces, keeping offsets. */
function stripComments(text) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') { depth++; out += ' '; continue; }
    if (ch === ')' && depth > 0) { depth--; out += ' '; continue; }
    if (depth > 0) { out += ch === '\n' ? '\n' : ' '; continue; }
    out += ch;
  }
  return out;
}

const SPRITE_ROW = /^[0-9.]+$/;

function parse(text, opts) {
  opts = opts || {};
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines = stripComments(text.replace(/\r\n?/g, '\n')).split('\n');
  const model = {
    lines: raw,
    clean: lines,
    sections: [],      // {name, line, end}
    prelude: [],       // {key, value, line}
    objects: [],       // {name, line, col, aliases:[{name,line,col}], colorsLine, colors:[{text,col}], sprite:[string], spriteLine}
    legend: [],        // {name, line, col, op:'='|'and'|'or', items:[string]}
    layers: [],        // [[names]]
    levels: [],        // {kind:'map'|'message', line, end, rows:[string], index}
    defs: new Map(),   // lowercase name -> {line, col, length, kind, target}
  };

  // A PSBS fragment (levels.pss…) has no section header: its section comes from the file name.
  const fragmentSection = opts.defaultSection && opts.defaultSection !== 'prelude' ? opts.defaultSection : null;
  let section = fragmentSection;
  const sectionAt = new Array(lines.length).fill(null);

  // Section headers (a section word alone on its line).
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim().toLowerCase();
    if (SECTIONS.includes(t)) {
      if (model.sections.length) model.sections[model.sections.length - 1].end = i - 1;
      model.sections.push({ name: t, line: i, end: lines.length - 1 });
      section = t;
      continue;
    }
    sectionAt[i] = section;
  }
  model.sectionAt = sectionAt;

  const isSep = (s) => /^=+$/.test(s.trim());
  const define = (name, line, col, kind, target) => {
    const k = name.toLowerCase();
    if (!model.defs.has(k)) model.defs.set(k, { name, line, col, length: name.length, kind, target });
  };

  // ---- prelude ----
  for (let i = 0; i < lines.length && !fragmentSection; i++) {
    if (sectionAt[i] !== null || model.sections.some((s) => s.line === i)) break;
    const m = /^\s*([a-z_]+)\b\s*(.*)$/i.exec(lines[i]);
    if (m && !isSep(lines[i])) model.prelude.push({ key: m[1].toLowerCase(), value: m[2].trim(), line: i });
  }

  // ---- objects ----
  let cur = null;
  let expect = 'name';
  for (let i = 0; i < lines.length; i++) {
    if (sectionAt[i] !== 'objects') continue;
    const s = lines[i];
    const t = s.trim();
    if (!t || isSep(s)) { expect = 'name'; continue; }
    if (expect === 'sprite' && SPRITE_ROW.test(t)) {
      if (!cur.sprite.length) cur.spriteLine = i;
      cur.sprite.push(t);
      continue;
    }
    if (expect === 'colors') {
      cur.colorsLine = i;
      const re = /\S+/g; let m;
      while ((m = re.exec(s))) cur.colors.push({ text: m[0], col: m.index });
      expect = 'sprite';
      continue;
    }
    // name line: Name [alias ...]
    const re = /\S+/g; let m; const toks = [];
    while ((m = re.exec(s))) toks.push({ name: m[0], line: i, col: m.index });
    cur = { name: toks[0].name, line: i, col: toks[0].col, aliases: toks.slice(1), colorsLine: -1, colors: [], sprite: [], spriteLine: -1 };
    model.objects.push(cur);
    define(cur.name, i, cur.col, 'object', cur);
    for (const a of cur.aliases) define(a.name, i, a.col, 'alias', cur);
    expect = 'colors';
  }

  // ---- legend ----
  for (let i = 0; i < lines.length; i++) {
    if (sectionAt[i] !== 'legend') continue;
    const s = lines[i];
    const m = /^(\s*)(\S+?)\s*=\s*(.*)$/.exec(s);
    if (!m) continue;
    const rhs = m[3].trim().split(/\s+/).filter(Boolean);
    let op = '=';
    const items = [];
    for (const tok of rhs) {
      const l = tok.toLowerCase();
      if (l === 'and' || l === 'or') op = l; else items.push(tok);
    }
    const entry = { name: m[2], line: i, col: m[1].length, op, items };
    model.legend.push(entry);
    define(entry.name, i, entry.col, 'legend', entry);
  }

  // ---- collision layers ----
  for (let i = 0; i < lines.length; i++) {
    if (sectionAt[i] !== 'collisionlayers') continue;
    const t = lines[i].trim();
    if (!t || isSep(t)) continue;
    model.layers.push(t.split(/[\s,]+/).filter(Boolean));
  }

  // ---- levels ----
  let lvl = null;
  for (let i = 0; i < lines.length; i++) {
    if (sectionAt[i] !== 'levels') { lvl = null; continue; }
    const t = lines[i].trim();
    if (!t || isSep(t)) { lvl = null; continue; }
    if (/^message\b/i.test(t)) {
      model.levels.push({ kind: 'message', line: i, end: i, rows: [t.slice(7).trim()] });
      lvl = null;
      continue;
    }
    if (!lvl) { lvl = { kind: 'map', line: i, end: i, rows: [] }; model.levels.push(lvl); }
    lvl.rows.push(t);
    lvl.end = i;
  }
  let n = 0;
  for (const l of model.levels) if (l.kind === 'map') l.index = ++n;

  return model;
}

/** Word (object/legend name or keyword) at a given position. */
function wordAt(lineText, col) {
  const re = /[^\s\[\]|(),=]+/g;
  let m;
  while ((m = re.exec(lineText))) {
    if (col >= m.index && col <= m.index + m[0].length) return { word: m[0], start: m.index, end: m.index + m[0].length };
  }
  return null;
}

/** All whole-word occurrences of `name` in code (not comments, not level maps, not messages). */
function findReferences(model, name) {
  const out = [];
  const target = name.toLowerCase();
  for (let i = 0; i < model.clean.length; i++) {
    const sec = model.sectionAt[i];
    if (sec === 'levels') continue;
    const s = model.clean[i];
    if (/^\s*message\b/i.test(s)) continue;
    const re = /[^\s\[\]|(),=]+/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[0].toLowerCase() === target) {
        // in OBJECTS only name lines count (colors/sprite lines can't be names)
        if (sec === 'objects') {
          const ob = model.objects.find((o) => o.line === i);
          if (!ob) continue;
        }
        out.push({ line: i, col: m.index, length: m[0].length });
      }
    }
  }
  return out;
}

/**
 * Resolve a level glyph into concrete object names (lowercase), following
 * legend "and" definitions and single-character object aliases.
 */
function resolveGlyph(model, ch) {
  const seen = new Set();
  const out = [];
  const visit = (name) => {
    const k = name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    const d = model.defs.get(k);
    if (!d) return;
    if (d.kind === 'object') { out.push(d.target.name.toLowerCase()); return; }
    if (d.kind === 'alias') { out.push(d.target.name.toLowerCase()); return; }
    if (d.kind === 'legend') {
      if (d.target.op === 'or') { visit(d.target.items[0]); return; } // property: show the first option
      for (const it of d.target.items) visit(it);
    }
  };
  visit(ch);
  return out;
}

module.exports = { parse, stripComments, wordAt, findReferences, resolveGlyph, SECTIONS };
