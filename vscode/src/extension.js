'use strict';
const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { parse, wordAt, findReferences } = require('./model');
const { spriteSvg, levelSvg } = require('./render');

const LANG = 'puzzlescript';
let engine = null; // lazy: loading the engine takes ~100ms

// The packaged extension carries copies of these next to src/; in the repo they live in lib/.
function requireLib(name) {
  try { return require('../' + name); } catch { return require('../../lib/' + name); }
}
function getEngine() {
  if (!engine) engine = requireLib('engine-node');
  return engine;
}
const psbs = requireLib('psbs-project');
const ENGINE_DIR = fs.existsSync(path.join(__dirname, '..', 'engine')) ? path.join(__dirname, '..', 'engine') : path.join(__dirname, '..', '..', 'engine');

// ---------------------------------------------------------------------------
// PSBS projects: the game is bin/script.txt, generated from src/*.pss. Each
// .pss is only a fragment, so we compile the whole script and map errors and
// definitions back to the .pss they came from.
const projects = new Map(); // root -> {mtime, text, lines, model, result, good, index}

function isPssDoc(doc) { return /\.pss$/i.test(doc.uri.fsPath || ''); }

function psbsRootFor(doc) {
  if (!doc.uri.fsPath) return null;
  return psbs.findProjectRoot(path.dirname(doc.uri.fsPath));
}

function projectInfo(root) {
  const script = psbs.scriptPath(root);
  let st;
  try { st = fs.statSync(script); } catch { return null; }
  let p = projects.get(root);
  if (p && p.mtime === st.mtimeMs) return p;
  const text = fs.readFileSync(script, 'utf8');
  let result;
  try { result = getEngine().compileSource(text, ENGINE_DIR); } catch (e) {
    result = { ok: false, issues: [{ line: null, severity: 'error', message: 'psbs-dev: ' + e.message }], objects: {}, levels: 0 };
  }
  const good = result.ok ? result : (p && p.good) || result;
  p = { mtime: st.mtimeMs, text, lines: text.split('\n'), model: parse(text), result, good, index: psbs.buildLineIndex(root) };
  projects.set(root, p);
  return p;
}

/** Where a 1-based line of bin/script.txt comes from: {file, line} (1-based) or null. */
function mapScriptLine(root, proj, line) {
  return psbs.mapLine(proj.index, proj.lines, line);
}

// ---------------------------------------------------------------------------
// Per-document cache: parsed model + last compile (and last *successful* one,
// so previews keep working while you have a typo).
const cache = new Map(); // uri -> {version, model, result, good}

function info(doc) {
  const key = doc.uri.toString();
  let c = cache.get(key);
  const root = isPssDoc(doc) ? psbsRootFor(doc) : null;
  if (root) return pssInfo(doc, root, c);
  if (c && c.version === doc.version) return c;
  const text = doc.getText();
  const model = parse(text);
  let result;
  try {
    result = getEngine().compileSource(text, path.join(__dirname, '..', 'engine'));
  } catch (e) {
    result = { ok: false, issues: [{ line: null, severity: 'error', message: 'psbs: ' + e.message }], objects: {}, levels: 0 };
  }
  const good = result.ok ? result : (c && c.good) || result;
  c = { version: doc.version, model, result, good };
  cache.set(key, c);
  return c;
}

function pssInfo(doc, root, c) {
  const proj = projectInfo(root);
  const mtime = proj ? proj.mtime : 0;
  if (c && c.version === doc.version && c.mtime === mtime) return c;
  const model = parse(doc.getText(), { defaultSection: psbs.sectionFromFilename(doc.uri.fsPath) });
  const file = path.resolve(doc.uri.fsPath);
  let result = { ok: true, issues: [], objects: {}, levels: 0, title: null };
  let good = result;
  const others = [];
  if (proj) {
    // Names defined anywhere in the project (other .pss files, loops in templates…)
    for (const [k, d] of proj.model.defs) {
      if (model.defs.has(k)) continue;
      const m = mapScriptLine(root, proj, d.line + 1);
      const at = m ? { file: m.file, line: m.line - 1 } : { file: psbs.scriptPath(root), line: d.line };
      model.defs.set(k, Object.assign({}, d, at));
    }
    // Project-wide lists are only for completion. model.objects/legend stay local to this
    // file because their line numbers drive colors, outline, etc. in *this* document.
    model.allObjects = model.objects.concat(proj.model.objects.filter((o) => !model.objects.some((x) => x.name.toLowerCase() === o.name.toLowerCase())));
    model.allLegend = model.legend.concat(proj.model.legend.filter((l) => !model.legend.some((x) => x.name.toLowerCase() === l.name.toLowerCase())));
    model.legendForGlyphs = proj.model.legend;
    model.layers = proj.model.layers;
    const issues = [];
    for (const i of proj.result.issues) {
      const m = i.line ? mapScriptLine(root, proj, i.line) : null;
      if (m && path.resolve(m.file) === file) issues.push(Object.assign({}, i, { line: m.line }));
      else others.push(i);
    }
    result = Object.assign({}, proj.result, { issues });
    good = proj.good;
  }
  c = { version: doc.version, mtime, model, result, good, root, others, projectOk: proj ? proj.result.ok : true };
  cache.set(doc.uri.toString(), c);
  return c;
}

// ---------------------------------------------------------------------------
// Static docs for hovers/completion
const KEYWORDS = {
  rules: {
    late: 'Regla que corre después de resolver el movimiento.',
    rigid: 'Si algún objeto de la regla no puede moverse, se cancela todo el movimiento.',
    random: 'De este grupo de reglas, se aplica una sola al azar.',
    up: 'Dirección absoluta.', down: 'Dirección absoluta.', left: 'Dirección absoluta.', right: 'Dirección absoluta.',
    horizontal: 'left o right.', vertical: 'up o down.', orthogonal: 'Cualquiera de las 4 direcciones.',
    moving: 'El objeto se está moviendo (en cualquier dirección).', stationary: 'El objeto no se mueve.',
    action: 'Se presionó la tecla de acción (X).', no: 'La celda NO contiene ese objeto.',
    randomdir: 'Dirección aleatoria.', parallel: '> o <', perpendicular: '^ o v',
    cancel: 'Cancela el turno.', again: 'Vuelve a correr las reglas después de un instante (animaciones).',
    win: 'Gana el nivel.', restart: 'Reinicia el nivel.', checkpoint: 'Guarda un punto de reinicio.',
    message: 'Muestra un mensaje.', startloop: 'Inicio de un bucle de reglas.', endloop: 'Fin de un bucle de reglas.',
  },
  winconditions: { all: 'Todos', some: 'Al menos uno', no: 'Ninguno', any: 'Al menos uno (sinónimo de some)', on: 'sobre' },
  sounds: {
    move: 'Cuando el objeto se mueve.', cantmove: 'Cuando el objeto intenta moverse y no puede.',
    create: 'Cuando se crea el objeto.', destroy: 'Cuando se destruye el objeto.', action: 'Al presionar acción.',
    undo: '', restart: '', titlescreen: '', startgame: '', cancel: '', endgame: '', startlevel: '', endlevel: '',
    showmessage: '', closemessage: '',
  },
  prelude: {
    title: 'Título del juego', author: 'Autor', homepage: 'Página web', background_color: 'Color de fondo del texto/menú',
    text_color: 'Color del texto', key_repeat_interval: 'Segundos entre repeticiones de tecla', realtime_interval: 'Segundos entre ticks automáticos (juego en tiempo real)',
    again_interval: 'Segundos entre pasos de "again"', flickscreen: 'Cámara por pantallas, ej: 8x6', zoomscreen: 'Cámara que sigue al jugador, ej: 8x6',
    color_palette: 'Paleta (1-14 o nombre: arnecolors, pastel...)', youtube: 'Música de fondo (id de YouTube)',
    run_rules_on_level_start: 'Corre las reglas al empezar cada nivel', norepeat_action: 'La acción no se repite manteniendo la tecla',
    require_player_movement: 'Si el jugador no se mueve, se cancela el turno', debug: 'Muestra info de depuración',
    verbose_logging: 'Log detallado de reglas aplicadas', throttle_movement: 'Limita movimiento en tiempo real', noundo: 'Desactiva deshacer (Z)',
    noaction: 'Desactiva la tecla de acción', norestart: 'Desactiva reiniciar (R)', scanline: 'Efecto de líneas CRT',
  },
};
for (let i = 0; i <= 10; i++) KEYWORDS.rules['sfx' + i] = 'Reproduce el sonido sfx' + i + ' (definido en SOUNDS).';
for (let i = 0; i <= 10; i++) KEYWORDS.sounds['sfx' + i] = '';
const COLORS = ['black', 'white', 'gray', 'darkgray', 'lightgray', 'grey', 'darkgrey', 'lightgrey', 'red', 'darkred', 'lightred', 'brown', 'darkbrown', 'lightbrown', 'orange', 'yellow', 'green', 'darkgreen', 'lightgreen', 'blue', 'lightblue', 'darkblue', 'purple', 'pink', 'transparent'];

// ---------------------------------------------------------------------------
// Diagnostics
function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection(LANG);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'puzzlescript.openGame';
  context.subscriptions.push(diagnostics, status);

  const timers = new Map();
  function refresh(doc) {
    if (doc.languageId !== LANG) return;
    const { result, model } = info(doc);
    const diags = [];
    for (const issue of result.issues) {
      let line = issue.line ? issue.line - 1 : (model.sections[0] ? model.sections[0].line : 0);
      line = Math.min(Math.max(0, line), doc.lineCount - 1);
      const tl = doc.lineAt(line);
      const range = new vscode.Range(line, tl.firstNonWhitespaceCharacterIndex, line, Math.max(tl.text.length, tl.firstNonWhitespaceCharacterIndex + 1));
      const d = new vscode.Diagnostic(range, issue.message, issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning);
      d.source = 'PuzzleScript';
      diags.push(d);
    }
    diagnostics.set(doc.uri, diags);
    updateStatus();
  }
  function schedule(doc, ms) {
    if (doc.languageId !== LANG) return;
    const k = doc.uri.toString();
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => refresh(doc), ms));
  }
  function updateStatus() {
    const ed = vscode.window.activeTextEditor;
    if (!ed || ed.document.languageId !== LANG) { status.hide(); return; }
    const inf = info(ed.document);
    const result = inf.root ? (projectInfo(inf.root) || inf).result : inf.result;
    const errs = result.issues.filter((i) => i.severity === 'error').length;
    status.text = errs ? `$(error) PuzzleScript: ${errs} error(es)` : `$(play) ${result.title || 'PuzzleScript'} · ${result.levels} nivel(es)`;
    status.tooltip = 'Abrir el juego al lado (psbs-dev)';
    status.show();
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => schedule(d, 0)),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document, 350)),
    vscode.workspace.onDidSaveTextDocument((d) => schedule(d, 0)),
    vscode.workspace.onDidCloseTextDocument((d) => { diagnostics.delete(d.uri); cache.delete(d.uri.toString()); }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
  );
  vscode.workspace.textDocuments.forEach((d) => schedule(d, 0));

  // PSBS: when bin/script.txt changes (psbs-dev dev or psbs build), refresh every open .pss.
  const watched = new Set();
  function watchProject(root) {
    if (watched.has(root)) return;
    watched.add(root);
    const script = psbs.scriptPath(root);
    fs.watchFile(script, { interval: 400 }, () => {
      projects.delete(root);
      for (const d of vscode.workspace.textDocuments) if (isPssDoc(d) && psbsRootFor(d) === root) { cache.delete(d.uri.toString()); refresh(d); }
    });
    context.subscriptions.push({ dispose: () => fs.unwatchFile(script) });
  }
  const building = new Set();
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => { if (isPssDoc(d)) { const r = psbsRootFor(d); if (r) watchProject(r); } }),
    vscode.workspace.onDidSaveTextDocument(async (d) => {
      if (!isPssDoc(d)) return;
      const root = psbsRootFor(d);
      if (!root) return;
      watchProject(root);
      // If psbs-dev dev is running it rebuilds by itself; otherwise build here.
      if (runningPort(psbs.scriptPath(root)) || building.has(root)) return;
      building.add(root);
      const r = await psbs.runBuild(root);
      building.delete(root);
      if (!r.ok) vscode.window.showWarningMessage('psbs build falló: ' + r.output.split('\n').slice(-3).join(' '));
    }),
  );
  for (const d of vscode.workspace.textDocuments) if (isPssDoc(d)) { const r = psbsRootFor(d); if (r) watchProject(r); }

  const sel = { language: LANG };

  // -------------------------------------------------------------------------
  // Completion
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider(sel, {
    provideCompletionItems(doc, pos) {
      const { model } = info(doc);
      const section = model.sectionAt[pos.line];
      const items = [];
      const add = (label, kind, detail, doc_) => {
        const it = new vscode.CompletionItem(label, kind);
        if (detail) it.detail = detail;
        if (doc_) it.documentation = doc_;
        items.push(it);
      };
      const names = () => {
        for (const o of model.allObjects || model.objects) {
          const it = new vscode.CompletionItem(o.name, vscode.CompletionItemKind.Class);
          it.detail = 'objeto';
          const obj = (info(doc).good.objects || {})[o.name.toLowerCase()];
          if (obj) it.documentation = new vscode.MarkdownString(`![](${spriteSvg(obj, 48)})`);
          items.push(it);
        }
        for (const l of model.allLegend || model.legend) {
          if (l.name.length === 1) continue; // glyphs only matter in levels
          add(l.name, l.op === 'or' ? vscode.CompletionItemKind.Interface : vscode.CompletionItemKind.Struct,
            `${l.op === 'or' ? 'propiedad' : 'leyenda'} = ${l.items.join(l.op === '=' ? ' ' : ` ${l.op} `)}`);
        }
      };
      const kw = (dict) => { for (const [k, v] of Object.entries(dict)) add(k, vscode.CompletionItemKind.Keyword, v || undefined); };

      if (section === null) kw(KEYWORDS.prelude);
      else if (section === 'objects') {
        const prevLine = pos.line > 0 ? doc.lineAt(pos.line - 1).text.trim() : '';
        const obj = model.objects.find((o) => o.line === pos.line - 1);
        if (obj || (prevLine && !/^[0-9.]+$/.test(prevLine) && model.objects.some((o) => o.colorsLine === pos.line))) {
          for (const c of COLORS) add(c, vscode.CompletionItemKind.Color, 'color');
        }
      } else if (section === 'legend') { names(); add('and', vscode.CompletionItemKind.Keyword); add('or', vscode.CompletionItemKind.Keyword); }
      else if (section === 'sounds') { names(); kw(KEYWORDS.sounds); }
      else if (section === 'collisionlayers') names();
      else if (section === 'rules') { names(); kw(KEYWORDS.rules); }
      else if (section === 'winconditions') { names(); kw(KEYWORDS.winconditions); }
      else if (section === 'levels') add('message', vscode.CompletionItemKind.Keyword, KEYWORDS.rules.message);
      return items;
    },
  }));

  // -------------------------------------------------------------------------
  // Hover: sprites, legend definitions, keyword docs, level previews
  context.subscriptions.push(vscode.languages.registerHoverProvider(sel, {
    provideHover(doc, pos) {
      const { model, good } = info(doc);
      const section = model.sectionAt[pos.line];
      if (section === 'levels') {
        const lvl = model.levels.find((l) => l.kind === 'map' && pos.line >= l.line && pos.line <= l.end);
        if (!lvl) return null;
        const md = new vscode.MarkdownString(`**Nivel ${lvl.index}** — ${[...lvl.rows[0]].length}×${lvl.rows.length}\n\n![](${levelSvg(model, lvl, good.objects)})`);
        return new vscode.Hover(md);
      }
      const w = wordAt(doc.lineAt(pos.line).text, pos.character);
      if (!w) return null;
      const key = w.word.toLowerCase();
      const range = new vscode.Range(pos.line, w.start, pos.line, w.end);
      const def = model.defs.get(key);
      if (def) {
        const target = def.kind === 'legend' ? null : def.target;
        if (target) {
          const obj = (good.objects || {})[target.name.toLowerCase()];
          const aliases = target.aliases.map((a) => '`' + a.name + '`').join(', ');
          const where = def.file ? `${path.basename(def.file)}:${def.line + 1}` : `línea ${target.line + 1}`;
          let s = `**${target.name}** _(objeto, ${where})_` + (aliases ? `  \nalias: ${aliases}` : '');
          if (obj) s += `\n\n![](${spriteSvg(obj, 80)})\n\n` + obj.colors.map((c) => '`' + c + '`').join(' ');
          return new vscode.Hover(new vscode.MarkdownString(s), range);
        }
        const l = def.target;
        const kind = l.op === 'or' ? 'propiedad' : l.items.length > 1 ? 'agregado' : 'sinónimo';
        const lwhere = def.file ? `${path.basename(def.file)}:${def.line + 1}` : `línea ${l.line + 1}`;
        return new vscode.Hover(new vscode.MarkdownString(`**${l.name}** _(${kind}, ${lwhere})_\n\n\`${l.name} = ${l.items.join(l.op === '=' ? ' ' : ` ${l.op} `)}\``), range);
      }
      const dict = section === null ? KEYWORDS.prelude : KEYWORDS[section];
      if (dict && dict[key]) return new vscode.Hover(new vscode.MarkdownString(`\`${key}\` — ${dict[key]}`), range);
      return null;
    },
  }));

  // -------------------------------------------------------------------------
  // Go to definition / references / rename
  context.subscriptions.push(vscode.languages.registerDefinitionProvider(sel, {
    provideDefinition(doc, pos) {
      const { model } = info(doc);
      let key;
      if (model.sectionAt[pos.line] === 'levels') {
        const ch = doc.lineAt(pos.line).text[pos.character];
        if (!ch) return null;
        key = ch.toLowerCase();
      } else {
        const w = wordAt(doc.lineAt(pos.line).text, pos.character);
        if (!w) return null;
        key = w.word.toLowerCase();
      }
      const d = model.defs.get(key);
      if (!d) return null;
      if (d.file && path.resolve(d.file) !== path.resolve(doc.uri.fsPath || '')) {
        let col = 0;
        try { col = Math.max(0, fs.readFileSync(d.file, 'utf8').split(/\r?\n/)[d.line].toLowerCase().indexOf(key)); } catch { /* ignore */ }
        return new vscode.Location(vscode.Uri.file(d.file), new vscode.Position(d.line, col));
      }
      return new vscode.Location(doc.uri, new vscode.Position(d.line, d.col));
    },
  }));
  context.subscriptions.push(vscode.languages.registerReferenceProvider(sel, {
    provideReferences(doc, pos) {
      const { model } = info(doc);
      const w = wordAt(doc.lineAt(pos.line).text, pos.character);
      if (!w || !model.defs.has(w.word.toLowerCase())) return [];
      return allReferences(doc, model, w.word).map((r) => new vscode.Location(r.uri, new vscode.Range(r.line, r.col, r.line, r.col + r.length)));
    },
  }));
  context.subscriptions.push(vscode.languages.registerRenameProvider(sel, {
    prepareRename(doc, pos) {
      const { model } = info(doc);
      const w = wordAt(doc.lineAt(pos.line).text, pos.character);
      if (!w || !model.defs.has(w.word.toLowerCase()) || model.sectionAt[pos.line] === 'levels') {
        throw new Error('Solo se pueden renombrar objetos y nombres de la leyenda.');
      }
      return new vscode.Range(pos.line, w.start, pos.line, w.end);
    },
    provideRenameEdits(doc, pos, newName) {
      if (!/^[^\s\[\]|(),=]+$/.test(newName)) throw new Error('Nombre inválido.');
      const { model } = info(doc);
      const w = wordAt(doc.lineAt(pos.line).text, pos.character);
      const edit = new vscode.WorkspaceEdit();
      for (const r of allReferences(doc, model, w.word)) edit.replace(r.uri, new vscode.Range(r.line, r.col, r.line, r.col + r.length), newName);
      return edit;
    },
  }));

  // -------------------------------------------------------------------------
  // Outline
  context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(sel, {
    provideDocumentSymbols(doc) {
      const { model } = info(doc);
      const lineRange = (a, b) => new vscode.Range(a, 0, b, doc.lineAt(Math.min(b, doc.lineCount - 1)).text.length);
      return model.sections.map((s) => {
        const sym = new vscode.DocumentSymbol(s.name.toUpperCase(), '', vscode.SymbolKind.Namespace, lineRange(s.line, s.end), lineRange(s.line, s.line));
        if (s.name === 'objects') {
          sym.children = model.objects.map((o) => {
            const end = Math.max(o.line, o.colorsLine, o.spriteLine >= 0 ? o.spriteLine + o.sprite.length - 1 : -1);
            return new vscode.DocumentSymbol(o.name, o.aliases.map((a) => a.name).join(' '), vscode.SymbolKind.Class, lineRange(o.line, end), lineRange(o.line, o.line));
          });
        } else if (s.name === 'legend') {
          sym.children = model.legend.map((l) => new vscode.DocumentSymbol(l.name, l.items.join(` ${l.op === '=' ? '' : l.op} `), vscode.SymbolKind.Constant, lineRange(l.line, l.line), lineRange(l.line, l.line)));
        } else if (s.name === 'levels') {
          sym.children = model.levels.map((l) => l.kind === 'map'
            ? new vscode.DocumentSymbol(`Nivel ${l.index}`, `${[...l.rows[0]].length}×${l.rows.length}`, vscode.SymbolKind.Field, lineRange(l.line, l.end), lineRange(l.line, l.line))
            : new vscode.DocumentSymbol('💬 ' + l.rows[0], '', vscode.SymbolKind.String, lineRange(l.line, l.line), lineRange(l.line, l.line)));
        }
        return sym;
      });
    },
  }));

  // -------------------------------------------------------------------------
  // Color swatches on object color lines (uses the compiler's resolved palette)
  context.subscriptions.push(vscode.languages.registerColorProvider(sel, {
    provideDocumentColors(doc) {
      const { model, good } = info(doc);
      const out = [];
      for (const o of model.objects) {
        const resolved = ((good.objects || {})[o.name.toLowerCase()] || {}).colors || [];
        o.colors.forEach((c, i) => {
          const hex = /^#[0-9a-f]{3,6}$/i.test(c.text) ? c.text : resolved[i];
          const col = parseHex(hex);
          if (col) out.push(new vscode.ColorInformation(new vscode.Range(o.colorsLine, c.col, o.colorsLine, c.col + c.text.length), col));
        });
      }
      return out;
    },
    provideColorPresentations(color) {
      const h = (v) => Math.round(v * 255).toString(16).padStart(2, '0').toUpperCase();
      return [new vscode.ColorPresentation(`#${h(color.red)}${h(color.green)}${h(color.blue)}`)];
    },
  }));

  // -------------------------------------------------------------------------
  // CodeLens: "▶ Jugar" above each level
  const lensEmitter = new vscode.EventEmitter();
  context.subscriptions.push(vscode.languages.registerCodeLensProvider(sel, {
    onDidChangeCodeLenses: lensEmitter.event,
    provideCodeLenses(doc) {
      const { model } = info(doc);
      const lenses = [];
      const top = model.sections.find((s) => s.name === 'levels');
      if (top) lenses.push(new vscode.CodeLens(new vscode.Range(top.line, 0, top.line, 0), { title: '▶ Abrir el juego al lado', command: 'puzzlescript.openGame' }));
      for (const l of model.levels) {
        if (l.kind !== 'map') continue;
        lenses.push(new vscode.CodeLens(new vscode.Range(l.line, 0, l.line, 0), {
          title: isPssDoc(doc) && psbsRootFor(doc) ? '▶ Jugar este nivel' : `▶ Jugar nivel ${l.index}`, command: 'puzzlescript.playLevel', arguments: [doc.uri, l.line],
        }));
      }
      return lenses;
    },
  }));

  // -------------------------------------------------------------------------
  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('puzzlescript.openGame', async (uri) => {
      const doc = await docFor(uri);
      if (!doc) return;
      const port = await ensureServer(doc);
      if (port) openPanel(port);
    }),
    vscode.commands.registerCommand('puzzlescript.openEditor', async (uri) => {
      const doc = await docFor(uri);
      if (!doc) return;
      const port = await ensureServer(doc);
      if (port) vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/`));
    }),
    vscode.commands.registerCommand('puzzlescript.playLevel', async (uri, line) => {
      const doc = await docFor(uri);
      if (!doc) return;
      if (line === undefined) line = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.selection.active.line : 0;
      if (doc.isDirty) await doc.save();
      const port = await ensureServer(doc);
      if (!port) return;
      openPanel(port);
      const target = isPssDoc(doc) ? scriptLineForPss(doc, line) : line;
      if (target === null) { vscode.window.showWarningMessage('No encontré este nivel en bin/script.txt (¿falta guardar o compilar?).'); return; }
      setTimeout(() => post(port, '/__psbs/goto', { line: target }), 700);
    }),
    vscode.commands.registerCommand('puzzlescript.build', async (uri) => {
      const doc = await docFor(uri);
      if (!doc) return;
      if (doc.isDirty) await doc.save();
      const t = terminal(path.dirname(doc.uri.fsPath));
      t.show();
      t.sendText(psbs.findProjectRoot(path.dirname(doc.uri.fsPath)) ? 'psbs-dev build' : `psbs-dev build ${shellQuote(path.basename(doc.uri.fsPath))}`);
    }),
  );
}

/** References in this document, or in every .pss of the PSBS project. */
function allReferences(doc, model, name) {
  const root = isPssDoc(doc) ? psbsRootFor(doc) : null;
  if (!root) return findReferences(model, name).map((r) => Object.assign({ uri: doc.uri }, r));
  const out = [];
  for (const f of psbs.listSourceFiles(root)) {
    if (!/\.pss$/i.test(f)) continue;
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath && path.resolve(d.uri.fsPath) === path.resolve(f));
    const text = open ? open.getText() : fs.readFileSync(f, 'utf8');
    const m = parse(text, { defaultSection: psbs.sectionFromFilename(f) });
    // Object definitions in a fragment without OBJECTS header still count as name lines.
    for (const r of findReferences(m, name)) out.push(Object.assign({ uri: open ? open.uri : vscode.Uri.file(f) }, r));
  }
  return out;
}

/** 0-based line in bin/script.txt for a 0-based line of a .pss level. */
function scriptLineForPss(doc, line) {
  const root = psbsRootFor(doc);
  const proj = root && projectInfo(root);
  if (!proj) return null;
  const text = doc.lineAt(line).text.trim();
  if (!text) return null;
  // n-th occurrence of this exact row inside the .pss -> n-th occurrence in the script
  let nth = 0;
  for (let i = 0; i < line; i++) if (doc.lineAt(i).text.trim() === text) nth++;
  for (let i = 0, seen = 0; i < proj.lines.length; i++) {
    if (proj.lines[i].trim() === text) { if (seen === nth) return i; seen++; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dev server integration
function parseHex(hex) {
  if (!hex) return null;
  let m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1], 16);
    return new vscode.Color(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
  }
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (m) return new vscode.Color(parseInt(m[1] + m[1], 16) / 255, parseInt(m[2] + m[2], 16) / 255, parseInt(m[3] + m[3], 16) / 255, 1);
  return null;
}

async function docFor(uri) {
  if (uri && uri.fsPath) return vscode.workspace.openTextDocument(uri);
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document.languageId === LANG) return ed.document;
  vscode.window.showWarningMessage('Abrí un archivo de PuzzleScript primero.');
  return null;
}

function registryFile(file) {
  const h = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'psbs-dev', h + '.json');
}

function runningPort(file) {
  try {
    const r = JSON.parse(fs.readFileSync(registryFile(file), 'utf8'));
    process.kill(r.pid, 0); // throws if the process is gone
    return r.port;
  } catch { return null; }
}

function shellQuote(s) {
  return /^[\w./-]+$/.test(s) ? s : JSON.stringify(s);
}

let term = null;
function terminal(cwd) {
  if (term && term.exitStatus === undefined) return term;
  term = vscode.window.createTerminal({ name: 'psbs', cwd });
  return term;
}

async function ensureServer(doc) {
  const root = psbs.findProjectRoot(path.dirname(doc.uri.fsPath));
  const file = root ? psbs.scriptPath(root) : doc.uri.fsPath;
  let port = runningPort(file);
  if (port) return port;
  const t = terminal(root || path.dirname(file));
  t.show(true);
  t.sendText(root ? 'psbs-dev dev --no-open' : `psbs-dev dev ${shellQuote(path.basename(file))} --no-open`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    port = runningPort(file);
    if (port) return port;
  }
  const pick = await vscode.window.showErrorMessage(
    'No pude iniciar "psbs-dev dev". ¿Está instalado? (npm install -g <carpeta de psbs-dev>)', 'Ver terminal');
  if (pick) t.show();
  return null;
}

function openPanel(port) {
  // VS Code's built-in Simple Browser shows the game next to the code.
  vscode.commands.executeCommand('simpleBrowser.api.open', vscode.Uri.parse(`http://localhost:${port}/play`), {
    viewColumn: vscode.ViewColumn.Beside, preserveFocus: true,
  }).then(undefined, () => vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${port}/play`)));
}

function post(port, p, body) {
  const data = JSON.stringify(body);
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } });
  req.on('error', () => {});
  req.end(data);
}

function deactivate() {}

module.exports = { activate, deactivate };
