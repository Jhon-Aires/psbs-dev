'use strict';
// Support for PSBS projects (PuzzleScript Build System, https://github.com/jcmiller11/PSBS):
//   config.yaml + src/*.pss  --(psbs build)-->  bin/script.txt
// Used by the CLI (rebuild on change) and by the VS Code extension (map
// compiler errors in bin/script.txt back to the .pss file they came from).

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

/** Walk up from `start` looking for a PSBS project root (config.yaml + src/). */
function findProjectRoot(start) {
  let dir = path.resolve(start);
  try { if (fs.statSync(dir).isFile()) dir = path.dirname(dir); } catch { /* ignore */ }
  for (;;) {
    if (fs.existsSync(path.join(dir, 'config.yaml')) && isDir(path.join(dir, 'src'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }

function scriptPath(root) { return path.join(root, 'bin', 'script.txt'); }

function listSourceFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(pss|txt)$/i.test(e.name)) out.push(p);
    }
  };
  walk(path.join(root, 'src'));
  return out;
}

/**
 * Build an index to map lines of bin/script.txt back to src files.
 * Heuristic: a generated line maps to a source line with identical text when
 * that text appears exactly once across src/ (true for almost all hand-written
 * lines; template-generated lines simply stay unmapped).
 */
function buildLineIndex(root, sources) {
  const index = new Map(); // trimmed text -> [{file, line}] (line is 1-based)
  for (const file of listSourceFiles(root)) {
    const text = sources && sources.get(file) !== undefined ? sources.get(file) : safeRead(file);
    if (text === null) continue;
    text.replace(/\r\n?/g, '\n').split('\n').forEach((l, i) => {
      const t = l.trim();
      if (t.length < 2 || /^=+$/.test(t)) return;
      if (!index.has(t)) index.set(t, []);
      index.get(t).push({ file, line: i + 1 });
    });
  }
  return index;
}

function mapLine(index, scriptLines, line) {
  if (!line) return null;
  const t = (scriptLines[line - 1] || '').trim();
  const hits = index.get(t);
  return hits && hits.length === 1 ? hits[0] : null;
}

function safeRead(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }

/** Section a .pss file contributes to, from its name (objects2.pss -> objects). */
function sectionFromFilename(file) {
  const m = /^(prelude|objects|legend|sounds|collisionlayers|rules|winconditions|levels)\d*\.pss$/i.exec(path.basename(file));
  return m ? m[1].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Running `psbs build`

let cachedCmd;
function psbsCommand() {
  if (cachedCmd) return cachedCmd;
  if (process.env.PSBS_CMD) {
    cachedCmd = { cmd: process.env.PSBS_CMD, args: [], shell: true };
    return cachedCmd;
  }
  const tries = [['psbs', []], ['python3', ['-m', 'psbs']], ['python', ['-m', 'psbs']], ['py', ['-m', 'psbs']]];
  for (const [cmd, args] of tries) {
    const r = spawnSync(cmd, [...args, 'help'], { stdio: 'ignore', shell: process.platform === 'win32' });
    if (!r.error && r.status === 0) { cachedCmd = { cmd, args, shell: process.platform === 'win32' }; return cachedCmd; }
  }
  return null;
}

/** Runs `psbs build` in `root`. Resolves {ok, output}. */
function runBuild(root) {
  return new Promise((resolve) => {
    const c = psbsCommand();
    if (!c) {
      resolve({ ok: false, output: 'No encontré PSBS. Instalalo con:  pip install psbs   (o definí PSBS_CMD)' });
      return;
    }
    const p = spawn(c.shell && c.args.length === 0 ? `${c.cmd} build` : c.cmd, c.shell && c.args.length === 0 ? [] : [...c.args, 'build'], {
      cwd: root, shell: c.shell, env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
    });
    let output = '';
    p.stdout.on('data', (d) => { output += d; });
    p.stderr.on('data', (d) => { output += d; });
    p.on('error', (e) => resolve({ ok: false, output: String(e) }));
    p.on('close', (code) => resolve({ ok: code === 0 && !/Traceback|^Error|error:/im.test(output), output: output.trim() }));
  });
}

/**
 * Watch src/ and config.yaml; call onChange(changedFile) debounced.
 * Uses recursive fs.watch (macOS/Windows/Linux on Node 20+) with a polling fallback.
 */
function watchSources(root, onChange) {
  let timer = null;
  let last = null;
  const fire = (f) => { last = f; clearTimeout(timer); timer = setTimeout(() => onChange(last), 120); };
  const src = path.join(root, 'src');
  try {
    fs.watch(src, { recursive: true }, (ev, name) => {
      if (!name || /(^|[\\/])\.|~$|\.swp$/.test(name)) return; // editor temp files
      fire(path.join(src, String(name)));
    });
  } catch {
    // Fallback: poll known files every 500 ms.
    const polled = new Set();
    const poll = () => {
      for (const f of listSourceFiles(root)) {
        if (polled.has(f)) continue;
        polled.add(f);
        fs.watchFile(f, { interval: 500 }, () => fire(f));
      }
    };
    poll();
    setInterval(poll, 2000).unref();
  }
  fs.watchFile(path.join(root, 'config.yaml'), { interval: 500 }, () => fire(path.join(root, 'config.yaml')));
}

module.exports = {
  findProjectRoot, scriptPath, listSourceFiles, buildLineIndex, mapLine, sectionFromFilename,
  psbsCommand, runBuild, watchSources,
};
