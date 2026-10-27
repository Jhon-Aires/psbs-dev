'use strict';
// Runs the official PuzzleScript compiler inside Node (no browser), so the CLI
// and the VS Code extension report exactly the same errors as puzzlescript.net.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SOURCE_FILES = [
  'js/storagewrapper.js',
  'js/bitvec.js',
  'js/level.js',
  'js/languageConstants.js',
  'js/globalVariables.js',
  'js/debug.js',
  'js/font.js',
  'js/rng.js',
  'js/riffwave.js',
  'js/sfxr.js',
  'js/codemirror/stringstream.js',
  'js/colorhelpers.js',
  'js/colors.js',
  'js/engine.js',
  'js/parser.js',
  'js/compiler.js',
];

function defaultEngineDir() {
  return path.join(__dirname, '..', 'engine');
}

function makeShims() {
  const storage = {};
  const noop = function () {};
  const el = () => ({
    style: {}, innerHTML: '', textContent: '', classList: { add: noop, remove: noop, contains: () => false },
    getContext: () => null, addEventListener: noop, removeEventListener: noop, setAttribute: noop,
  });
  const g = {
    console: { log: noop, warn: noop, error: noop, info: noop },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
      setItem: (k, v) => { storage[k] = String(v); },
      removeItem: (k) => { delete storage[k]; },
    },
    document: {
      URL: 'psbs://', body: el(), createElement: el, getElementById: () => null,
      addEventListener: noop, removeEventListener: noop,
    },
    lastDownTarget: null, canvas: null,
    canvasResize: noop, redraw: noop, forceRegenImages: noop,
    consolePrintFromRule: noop, consolePrint: noop, console_print_raw: noop, consoleError: noop,
    consoleCacheDump: noop, addToDebugTimeline: noop, killAudioButton: noop, showAudioButton: noop,
    regenSpriteImages: noop, jumpToLine: noop, printLevel: noop, playSound: noop,
    UnitTestingThrow: noop, setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop,
    levelString: '', inputString: '', outputString: '',
  };
  g.window = g;
  g.input = g.document.createElement('TEXTAREA');
  g.editor = { getValue: () => g.levelString };
  return g;
}

const DRIVER = `
function __psbs_strip(html) {
  return String(html).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
}
function __psbs_compile(text) {
  const issues = [];
  let crash = null;
  const before = state;
  try {
    compile(["restart"], text + "\\n");
  } catch (e) {
    crash = (e && e.message) || String(e);
  }
  for (const html of errorStrings) {
    const severity = /warningText/.test(html) ? 'warning' : 'error';
    const m = /line (\\d+)/.exec(__psbs_strip(html.split('</a>')[0] || ''));
    const hasLine = /errorTextLineNumber/.test(html) && m;
    const message = __psbs_strip(hasLine ? html.split('</a>').slice(1).join('</a>') : html).replace(/^\\s*:\\s*/, '').trim();
    issues.push({ line: hasLine ? parseInt(m[1], 10) : null, severity, message });
  }
  if (crash) issues.push({ line: null, severity: 'error', message: 'El compilador falló: ' + crash });
  const out = { issues, title: null, objects: {}, levels: 0, ok: !issues.some(i => i.severity === 'error') };
  if (state && state !== before && state.metadata) {
    out.title = state.metadata.title || null;
    out.levels = (state.levels || []).length;
    for (const name of Object.keys(state.objects || {})) {
      const o = state.objects[name];
      out.objects[name] = { colors: o.colors, sprite: o.spritematrix, line: o.lineNumber };
    }
    out.bgcolor = state.bgcolor;
    out.fgcolor = state.fgcolor;
    out.metadata = Object.assign({}, state.metadata);
  }
  return JSON.stringify(out);
}
`;

let cached = null;

function getContext(engineDir) {
  engineDir = engineDir || defaultEngineDir();
  if (cached && cached.dir === engineDir) return cached.ctx;
  let code = '';
  for (const f of SOURCE_FILES) {
    code += `\n// ---- ${f} ----\n` + fs.readFileSync(path.join(engineDir, f), 'utf8') + '\n';
  }
  code += DRIVER;
  const ctx = vm.createContext(makeShims());
  vm.runInContext(code, ctx, { filename: 'puzzlescript-engine.js' });
  cached = { dir: engineDir, ctx };
  return ctx;
}

/**
 * Compile PuzzleScript source with the official compiler.
 * @returns {{ok:boolean, issues:{line:number|null,severity:'error'|'warning',message:string}[], title:string|null, levels:number, objects:Object}}
 */
function compileSource(text, engineDir) {
  const ctx = getContext(engineDir);
  return JSON.parse(ctx.__psbs_compile(String(text).replace(/\r\n?/g, '\n')));
}

module.exports = { compileSource, defaultEngineDir };
