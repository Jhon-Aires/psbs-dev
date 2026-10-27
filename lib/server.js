'use strict';
// Dev server: serves the official PuzzleScript editor wired to a file on disk.
//  - Hot reload: when the file changes, the browser editor updates and the game
//    recompiles, staying on the level you were playing.
//  - Ctrl+S in the browser writes back to the same file.
//  - Errors are printed in the terminal as file:line (clickable in VS Code).

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { compileSource } = require('./engine-node');
const { buildStandaloneHtml } = require('./build');
const psbs = require('./psbs-project');
const ui = require('./ui');

const ENGINE = path.join(__dirname, '..', 'engine');
const WEB = path.join(__dirname, '..', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.md': 'text/plain; charset=utf-8',
};

function startServer({ file, port, open, psbsRoot }) {
  const absFile = path.resolve(file);
  const fileName = psbsRoot ? 'PSBS: ' + path.basename(psbsRoot) : path.basename(absFile);
  const readonly = !!psbsRoot;
  const clients = new Set();
  let lastText = readText();
  let lastWrittenByBrowser = null;
  let lastResult = report(lastText, true);

  function readText() {
    try { return fs.readFileSync(absFile, 'utf8'); } catch { return null; }
  }

  function report(text, first) {
    if (text === null) { ui.warn(`No se pudo leer ${fileName}`); return null; }
    const r = compileSource(text);
    ui.printResult(absFile, r, first ? 'inicial' : 'recarga', psbsRoot ? psbsMapper(text) : null);
    return r;
  }

  function payload(text, r, source) {
    return JSON.stringify({
      type: 'change', source, text,
      levels: r ? r.levels : 0,
      errors: r ? r.issues.filter((i) => i.severity === 'error').length : 0,
    });
  }

  function broadcast(data) {
    for (const res of clients) res.write(`data: ${data}\n\n`);
  }

  // Debounced watcher. fs.watch on the directory survives editors that save by
  // replacing the file (vim, some VS Code settings).
  let timer = null;
  const onFsEvent = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = readText();
      if (text === null || text === lastText) return;
      lastText = text;
      if (text === lastWrittenByBrowser) { lastWrittenByBrowser = null; return; }
      lastResult = report(text, false);
      broadcast(payload(text, lastResult, 'disk'));
    }, 60);
  };
  fs.mkdirSync(path.dirname(absFile), { recursive: true });
  fs.watch(path.dirname(absFile), (ev, name) => { if (!name || name === path.basename(absFile)) onFsEvent(); });
  fs.watchFile(absFile, { interval: 500 }, onFsEvent); // fallback for network drives

  // PSBS: rebuild bin/script.txt whenever src/ or config.yaml changes. The
  // watcher above then picks up the new script and hot-reloads it.
  if (psbsRoot) {
    let building = false, again = false;
    const rebuild = async (changed) => {
      if (building) { again = true; return; }
      building = true;
      const rel = changed ? path.relative(psbsRoot, changed) : '';
      ui.info(ui.dim(`psbs build${rel ? '  (' + rel + ')' : ''}…`));
      const r = await psbs.runBuild(psbsRoot);
      if (!r.ok) {
        console.log(r.output.split('\n').map((l) => '  ' + l).join('\n'));
        ui.warn('✖ psbs build falló (el juego sigue con la última versión que compiló)');
        broadcast(JSON.stringify({ type: 'build-error', message: r.output }));
      } else {
        const text = readText();
        if (text === lastText) ui.info(ui.dim('sin cambios en bin/script.txt'));
      }
      building = false;
      if (again) { again = false; rebuild(); }
    };
    psbs.watchSources(psbsRoot, rebuild);
  }

  function psbsMapper(text) {
    const index = psbs.buildLineIndex(psbsRoot);
    const lines = text.split('\n');
    return (line) => {
      const m = psbs.mapLine(index, lines, line);
      return m ? `${ui.rel(m.file)}:${m.line}` : null;
    };
  }

  function send(res, code, body, type) {
    res.writeHead(code, { 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function serveStatic(res, root, rel) {
    const p = path.normalize(path.join(root, rel));
    if (!p.startsWith(root)) return send(res, 403, 'forbidden');
    fs.readFile(p, (err, data) => {
      if (err) return send(res, 404, 'not found');
      send(res, 200, data, MIME[path.extname(p).toLowerCase()] || 'application/octet-stream');
    });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p === '/' || p === '/index.html') {
      res.writeHead(302, { Location: '/editor.html?demo=__psbs_game' });
      return res.end();
    }
    if (p === '/editor.html') {
      let html = fs.readFileSync(path.join(ENGINE, 'editor.html'), 'utf8');
      html = html.replace('</head>', '<link rel="stylesheet" href="/__psbs/bridge.css">\n</head>');
      html = html.replace(/(<\/body>)(?![\s\S]*<\/body>)/, '<script src="/__psbs/bridge.js"></script>\n$1');
      return send(res, 200, html, MIME['.html']);
    }
    if (p === '/demo/__psbs_game.txt') {
      return send(res, 200, readText() || '', MIME['.txt']);
    }
    if (p === '/play') {
      const text = readText() || '';
      const r = compileSource(text);
      try {
        const html = buildStandaloneHtml(text, r, { hotReload: true });
        return send(res, 200, html, MIME['.html']);
      } catch (e) {
        return send(res, 500, String(e));
      }
    }
    if (p === '/__psbs/info') {
      return send(res, 200, JSON.stringify({ file: absFile, name: fileName, levels: lastResult ? lastResult.levels : 0 }), MIME['.json']);
    }
    if (p === '/__psbs/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', name: fileName, file: absFile, readonly, levels: lastResult ? lastResult.levels : 0 })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { clearInterval(ping); clients.delete(res); });
      return;
    }
    if (p === '/__psbs/save' && req.method === 'POST' && readonly) {
      return send(res, 409, JSON.stringify({ ok: false, error: 'Este juego lo genera PSBS (bin/script.txt). Editá los archivos .pss de src/.' }), MIME['.json']);
    }
    if (p === '/__psbs/save' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 20e6) req.destroy(); });
      req.on('end', () => {
        try {
          const { text } = JSON.parse(body);
          if (typeof text !== 'string') throw new Error('bad body');
          lastWrittenByBrowser = text;
          fs.writeFileSync(absFile, text, 'utf8');
          lastText = text;
          ui.info(`Guardado desde el navegador → ${fileName}`);
          lastResult = report(text, false);
          broadcast(payload(text, lastResult, 'browser'));
          send(res, 200, JSON.stringify({ ok: true, levels: lastResult ? lastResult.levels : 0 }), MIME['.json']);
        } catch (e) {
          send(res, 400, JSON.stringify({ ok: false, error: String(e) }), MIME['.json']);
        }
      });
      return;
    }
    if (p === '/__psbs/goto' && req.method === 'POST') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const { line } = JSON.parse(body);
          broadcast(JSON.stringify({ type: 'goto', line: Number(line) || 0 }));
          send(res, 200, '{"ok":true}', MIME['.json']);
        } catch (e) { send(res, 400, String(e)); }
      });
      return;
    }
    if (p.startsWith('/__psbs/')) return serveStatic(res, WEB, p.slice('/__psbs/'.length));
    return serveStatic(res, ENGINE, p);
  });

  return new Promise((resolve, reject) => {
    let tries = 0;
    const listen = (prt) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && tries++ < 20) return listen(prt + 1);
        reject(e);
      });
      server.listen(prt, '127.0.0.1', () => {
        const url = `http://localhost:${prt}/`;
        ui.ready(psbsRoot ? path.join(psbsRoot, 'src') : absFile, url);
        registerServer(absFile, prt);
        if (open !== false && open !== undefined) ui.openBrowser(url + (typeof open === 'string' ? open : ''));
        resolve({ server, url });
      });
    };
    listen(port);
  });
}

// So the VS Code extension can find a running server for a given file.
function registryFile(file) {
  const h = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'psbs-dev', h + '.json');
}

function registerServer(file, port) {
  const reg = registryFile(file);
  try {
    fs.mkdirSync(path.dirname(reg), { recursive: true });
    fs.writeFileSync(reg, JSON.stringify({ file, port, pid: process.pid }));
  } catch { return; }
  const cleanup = () => { try { const r = JSON.parse(fs.readFileSync(reg, 'utf8')); if (r.pid === process.pid) fs.unlinkSync(reg); } catch { /* gone */ } };
  process.on('exit', cleanup);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(0); });
}

module.exports = { startServer };
