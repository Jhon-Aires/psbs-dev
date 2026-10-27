'use strict';
// Smoke tests: compiler wrapper, CLI, and the VS Code extension providers (mocked API).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); } catch (e) { console.log('  ✖ ' + name + '\n    ' + (e.stack || e)); process.exitCode = 1; }
}

const { compileSource } = require('../lib/engine-node');
const template = fs.readFileSync(path.join(ROOT, 'templates', 'game.txt'), 'utf8');

test('el template compila sin errores', () => {
  const r = compileSource(template);
  assert.ok(r.ok, JSON.stringify(r.issues));
  assert.strictEqual(r.levels, 4);
});

test('todos los ejemplos oficiales compilan', () => {
  const dir = path.join(ROOT, 'engine', 'demo');
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
    const r = compileSource(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.ok(r.ok, f + ': ' + JSON.stringify(r.issues[0]));
  }
});

test('reporta errores con número de línea', () => {
  const r = compileSource(template.replace('[ > Player | Crate ]', '[ > Player | Crat ]'));
  assert.ok(!r.ok);
  assert.ok(r.issues.some((i) => i.line && /crat/i.test(i.message)));
});

test('CLI: new + check + build', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'psbs-test-'));
  const cli = path.join(ROOT, 'bin', 'psbs-dev.js');
  execFileSync(process.execPath, [cli, 'new', 'demo-game'], { cwd: tmp });
  const dir = path.join(tmp, 'demo-game');
  assert.ok(fs.existsSync(path.join(dir, 'game.txt')));
  assert.ok(fs.existsSync(path.join(dir, '.vscode', 'settings.json')));
  execFileSync(process.execPath, [cli, 'check'], { cwd: dir });
  execFileSync(process.execPath, [cli, 'build', '-o', 'out.html'], { cwd: dir });
  const html = fs.readFileSync(path.join(dir, 'out.html'), 'utf8');
  assert.ok(html.includes('Empujá las cajas'));
  assert.ok(!html.includes('__GAMEDAT__'));
  fs.writeFileSync(path.join(dir, 'game.txt'), template.replace('Crate MOVE', 'Crat MOVE'));
  assert.throws(() => execFileSync(process.execPath, [cli, 'check'], { cwd: dir, stdio: 'pipe' }));
});

// ---- VS Code extension with a mocked API ----
const mock = require('./vscode-mock');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'vscode') return require.resolve('./vscode-mock');
  return origResolve.call(this, req, ...rest);
};
// Use the repo's engine-node when the packaged copy hasn't been built.
const extEngine = path.join(ROOT, 'vscode', 'engine-node.js');
if (!fs.existsSync(extEngine)) {
  console.log('  (ejecutá npm run build:vscode para probar la copia empaquetada)');
}
const ext = require('../vscode/src/extension');
const badDoc = mock.makeDoc(template.replace('[ > Player | Crate ]', '[ > Player | Crat ]'), '/tmp/bad.txt');
mock.workspace.textDocuments.push(badDoc);
ext.activate({ subscriptions: [] });
const doc = mock.makeDoc(template, '/tmp/game.txt');
const P = mock.providers;
const lines = template.split('\n');
const lineOf = (s, from = 0) => lines.findIndex((l, i) => i >= from && l.includes(s));

test('extensión: autocompletado en RULES incluye objetos y palabras clave', () => {
  const items = P.completion.provideCompletionItems(doc, new mock.Position(lineOf('[ > Player'), 0)).map((i) => i.label);
  for (const w of ['Player', 'Crate', 'late', 'again', 'cancel']) assert.ok(items.includes(w), w);
});

test('extensión: hover de objeto muestra sprite', () => {
  const h = P.hover.provideHover(doc, new mock.Position(lineOf('[ > Player'), 5));
  assert.ok(h && /Player/.test(h.contents[0].value) && /data:image\/svg\+xml/.test(h.contents[0].value));
});

test('extensión: hover sobre un nivel muestra el mapa', () => {
  const h = P.hover.provideHover(doc, new mock.Position(lineOf('#@P..#'), 1));
  assert.ok(h && /Nivel 1/.test(h.contents[0].value));
});

test('extensión: ir a definición (nombre y carácter del mapa)', () => {
  const d1 = P.definition.provideDefinition(doc, new mock.Position(lineOf('[ > Player'), 13));
  assert.strictEqual(d1.range.start.line, lineOf('Crate', lineOf('OBJECTS')));
  const lvl = lineOf('#@P..#');
  const d2 = P.definition.provideDefinition(doc, new mock.Position(lvl, lines[lvl].indexOf('@')));
  assert.strictEqual(d2.range.start.line, lineOf('@ = Crate'));
});

test('extensión: renombrar actualiza todas las referencias', () => {
  const e = P.rename.provideRenameEdits(doc, new mock.Position(lineOf('[ > Player'), 13), 'Box');
  assert.ok(e.edits.length >= 6, String(e.edits.length));
});

test('extensión: esquema, colores y codelens', () => {
  const syms = P.symbols.provideDocumentSymbols(doc);
  assert.deepStrictEqual(syms.map((s) => s.name), ['OBJECTS', 'LEGEND', 'SOUNDS', 'COLLISIONLAYERS', 'RULES', 'WINCONDITIONS', 'LEVELS']);
  assert.ok(P.color.provideDocumentColors(doc).length >= 10);
  assert.strictEqual(P.codelens.provideCodeLenses(doc).filter((l) => /Jugar nivel/.test(l.command.title)).length, 2);
});


// ---- PSBS projects ----
const psbs = require('../lib/psbs-project');
function makePsbsProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psbs-proj-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'config.yaml'), 'gist_id: ""\ntemplate: main.pss\n');
  const parts = template.split(/^=+\n(OBJECTS|LEGEND|SOUNDS|COLLISIONLAYERS|RULES|WINCONDITIONS|LEVELS)\n=+\n/m);
  const main = ['(% include "prelude.pss" +%)'];
  fs.writeFileSync(path.join(root, 'src', 'prelude.pss'), parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const n = parts[i].toLowerCase();
    fs.writeFileSync(path.join(root, 'src', n + '.pss'), parts[i + 1]);
    main.push('='.repeat(n.length + 1), parts[i], '='.repeat(n.length + 1), `(% include "${n}.pss" +%)`);
  }
  fs.writeFileSync(path.join(root, 'src', 'main.pss'), main.join('\n'));
  return root;
}
process.env.PSBS_CMD = `"${process.execPath}" "${path.join(__dirname, 'fake-psbs.js')}"`;
const proot = makePsbsProject();
const pf = (n) => path.join(proot, 'src', n);

test('PSBS: check compila el proyecto (psbs build + compilador)', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'bin', 'psbs-dev.js'), 'check'], { cwd: proot, env: process.env, encoding: 'utf8' });
  assert.ok(/4 nivel/.test(out), out);
  assert.ok(fs.existsSync(path.join(proot, 'bin', 'script.txt')));
});

test('PSBS: errores mapeados al .pss correcto', () => {
  const rules = fs.readFileSync(pf('rules.pss'), 'utf8');
  fs.writeFileSync(pf('rules.pss'), rules.replace('Crate ]', 'Crat ]'));
  let out = '';
  try { execFileSync(process.execPath, [path.join(ROOT, 'bin', 'psbs-dev.js'), 'check'], { cwd: proot, env: process.env, encoding: 'utf8' }); } catch (e) { out = e.stdout; }
  fs.writeFileSync(pf('rules.pss'), rules);
  assert.ok(/src[\\/]rules\.pss:\d+/.test(out), out);
});

const levelsDoc = mock.makeDoc(fs.readFileSync(pf('levels.pss'), 'utf8'), pf('levels.pss'));
const rulesDoc = mock.makeDoc(fs.readFileSync(pf('rules.pss'), 'utf8'), pf('rules.pss'));

test('PSBS ext: autocompletado en rules.pss trae objetos de objects.pss', () => {
  const items = P.completion.provideCompletionItems(rulesDoc, new mock.Position(1, 0)).map((i) => i.label);
  for (const w of ['Player', 'Crate', 'late']) assert.ok(items.includes(w), w + ' en ' + items.join(','));
});

test('PSBS ext: ir a definición salta a objects.pss', () => {
  const l = rulesDoc.getText().split('\n').findIndex((x) => x.includes('Crate'));
  const col = rulesDoc.getText().split('\n')[l].indexOf('Crate') + 1;
  const d = P.definition.provideDefinition(rulesDoc, new mock.Position(l, col));
  assert.ok(d && /objects\.pss$/.test(d.uri.fsPath || ''), JSON.stringify(d));
});

test('PSBS ext: hover sobre un nivel de levels.pss muestra el mapa', () => {
  const l = levelsDoc.getText().split('\n').findIndex((x) => x.includes('#@P..#'));
  const h = P.hover.provideHover(levelsDoc, new mock.Position(l, 1));
  assert.ok(h && /data:image\/svg/.test(h.contents[0].value));
});

test('PSBS ext: renombrar cambia todos los .pss', () => {
  const l = rulesDoc.getText().split('\n').findIndex((x) => x.includes('Crate'));
  const col = rulesDoc.getText().split('\n')[l].indexOf('Crate') + 1;
  const e = P.rename.provideRenameEdits(rulesDoc, new mock.Position(l, col), 'Box');
  const files = new Set(e.edits.map((x) => path.basename(x.uri.fsPath)));
  for (const f of ['objects.pss', 'legend.pss', 'rules.pss', 'collisionlayers.pss']) assert.ok(files.has(f), f + ': ' + [...files]);
});

test('PSBS ext: los selectores de color solo aparecen en las líneas de color del propio archivo', () => {
  assert.strictEqual(P.color.provideDocumentColors(rulesDoc).length, 0);
  assert.strictEqual(P.color.provideDocumentColors(levelsDoc).length, 0);
  const objDoc = mock.makeDoc(fs.readFileSync(pf('objects.pss'), 'utf8'), pf('objects.pss'));
  const lines = objDoc.getText().split('\n');
  const cols = P.color.provideDocumentColors(objDoc);
  assert.ok(cols.length > 0);
  for (const c of cols) assert.ok(!/^[0-9.]+$/.test(lines[c.range.start.line].trim()), lines[c.range.start.line]);
});

test('PSBS ext: un .pss suelto no muestra errores falsos', () => {
  const bad = mock.makeDoc(fs.readFileSync(pf('levels.pss'), 'utf8'), pf('levels.pss'));
  const c = P.codelens.provideCodeLenses(bad);
  assert.ok(c.length >= 2);
});

setTimeout(() => {
  test('extensión: diagnósticos del compilador en la línea correcta', () => {
    const d = mock.diagnostics.get(badDoc.uri.toString());
    assert.ok(d && d.length, 'sin diagnósticos');
    assert.ok(d.some((x) => x.range.start.line === lineOf('[ > Player') && /crat/i.test(x.message)));
  });
  console.log(`\n${passed} pruebas OK`);
}, 100);
