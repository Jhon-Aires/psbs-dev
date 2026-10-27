#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ui = require('../lib/ui');
const psbs = require('../lib/psbs-project');

const ROOT = path.join(__dirname, '..');
const pkg = require('../package.json');

const HELP = `
${ui.bold('psbs-dev')} — entorno de desarrollo local para PuzzleScript  ${ui.dim('v' + pkg.version)}

${ui.bold('Uso')}
  psbs-dev dev [archivo.txt]      Juego en el navegador con hot reload
  psbs-dev check [archivo.txt]    Compila y muestra errores (exit 1 si hay errores)
  psbs-dev build [archivo.txt]    Exporta el juego a un único .html jugable offline
  psbs-dev new <nombre>           Crea un proyecto simple (un solo game.txt)
  psbs-dev init                   Configura VS Code en la carpeta actual
  psbs-dev vscode                 Instala la extensión de VS Code
  psbs-dev help                   Esta ayuda

${ui.bold('Proyectos PSBS')}
  Si la carpeta tiene config.yaml + src/ (proyecto de PSBS), "dev" corre
  "psbs build" cada vez que guardás un .pss y recarga el juego desde bin/script.txt.

${ui.bold('Opciones')}
  --editor        Abrir el editor oficial (además del juego) en vez de solo el juego
  --port <n>      Puerto para "dev" (por defecto 3000; si está ocupado usa el siguiente)
  --no-open       No abrir el navegador automáticamente
  -o, --out <f>   Archivo de salida para "build"

Sin archivo: usa el proyecto PSBS de la carpeta, o game.txt / el único .txt.
`;

function parseArgs(argv) {
  const args = { _: [], port: 3000, open: true, out: null, editor: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = parseInt(argv[++i], 10);
    else if (a === '--no-open') args.open = false;
    else if (a === '--editor' || a === '-e') args.editor = true;
    else if (a === '-o' || a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args._.unshift('help');
    else if (a === '-v' || a === '--version') args._.unshift('version');
    else args._.push(a);
  }
  return args;
}

function findGameFile(explicit) {
  if (explicit) {
    if (!fs.existsSync(explicit)) die(`No existe el archivo: ${explicit}`);
    return explicit;
  }
  const exts = ['.txt', '.puzzlescript', '.pzs'];
  const candidates = fs.readdirSync(process.cwd())
    .filter((f) => exts.includes(path.extname(f).toLowerCase()) && fs.statSync(f).isFile())
    .filter((f) => !/^(readme|license|licence|changelog|notes?)\b/i.test(f));
  if (candidates.includes('game.txt')) return 'game.txt';
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) {
    die('No encontré ningún juego en esta carpeta (ni proyecto PSBS ni .txt).\n  Proyecto PSBS:  psbs new mi-juego\n  Proyecto simple: psbs-dev new mi-juego');
  }
  die(`Hay varios .txt en esta carpeta; indicá cuál:\n  ${candidates.map((c) => 'psbs-dev dev ' + JSON.stringify(c)).join('\n  ')}`);
}

function die(msg) {
  ui.error(msg);
  process.exit(1);
}

function writeVSCodeSettings(dir) {
  const vsdir = path.join(dir, '.vscode');
  fs.mkdirSync(vsdir, { recursive: true });
  const settingsPath = path.join(vsdir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {
      ui.warn('.vscode/settings.json tiene comentarios o no es JSON válido; agregá a mano: "files.associations": { "*.txt": "puzzlescript" }');
      return;
    }
  }
  const assoc = psbs.findProjectRoot(dir) ? { '*.pss': 'puzzlescript', 'bin/*.txt': 'puzzlescript' } : { '*.txt': 'puzzlescript' };
  settings['files.associations'] = Object.assign({}, settings['files.associations'], assoc);
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const tasksPath = path.join(vsdir, 'tasks.json');
  if (!fs.existsSync(tasksPath)) {
    fs.writeFileSync(tasksPath, JSON.stringify({
      version: '2.0.0',
      tasks: [
        { label: 'psbs-dev: dev', type: 'shell', command: 'psbs-dev dev', isBackground: true, problemMatcher: [], group: { kind: 'build', isDefault: true } },
        { label: 'psbs-dev: build', type: 'shell', command: 'psbs-dev build', problemMatcher: [] },
      ],
    }, null, 2) + '\n');
  }
}

/** A PSBS project (rebuilt first) or a plain .txt game. */
async function resolveGame(explicit) {
  const root = !explicit && psbs.findProjectRoot(process.cwd());
  if (!root) return { file: findGameFile(explicit), psbsRoot: null };
  console.log(ui.dim(`Proyecto PSBS: ${root}`));
  console.log(ui.dim('psbs build…'));
  const r = await psbs.runBuild(root);
  if (!r.ok) {
    console.log(r.output);
    if (!fs.existsSync(psbs.scriptPath(root))) die('psbs build falló y no hay bin/script.txt todavía.');
    ui.warn('psbs build falló; uso el bin/script.txt anterior.');
  }
  return { file: psbs.scriptPath(root), psbsRoot: root };
}

/** For PSBS projects: maps bin/script.txt lines to "src/x.pss:N". */
function mapperFor(psbsRoot, text) {
  if (!psbsRoot) return null;
  const index = psbs.buildLineIndex(psbsRoot);
  const lines = text.split('\n');
  return (line) => { const m = psbs.mapLine(index, lines, line); return m ? `${ui.rel(m.file)}:${m.line}` : null; };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'help';

  switch (cmd) {
    case 'help':
      console.log(HELP);
      return;

    case 'version':
      console.log(pkg.version);
      return;

    case 'new': {
      const name = args._[1];
      if (!name) die('Uso: psbs new <nombre>');
      const dir = path.resolve(name);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) die(`La carpeta ${name} ya existe y no está vacía.`);
      fs.mkdirSync(dir, { recursive: true });
      const title = path.basename(dir).replace(/[-_]+/g, ' ');
      const tpl = fs.readFileSync(path.join(ROOT, 'templates', 'game.txt'), 'utf8').replace(/__TITLE__/g, title);
      fs.writeFileSync(path.join(dir, 'game.txt'), tpl);
      fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n.DS_Store\n');
      writeVSCodeSettings(dir);
      console.log(`\n  ${ui.green('✔')} Proyecto creado en ${ui.bold(name)}/\n`);
      console.log(`  cd ${/\s/.test(name) ? JSON.stringify(name) : name}`);
      console.log('  code .        # abrir en VS Code');
      console.log('  psbs-dev dev  # juego con hot reload\n');
      return;
    }

    case 'init': {
      writeVSCodeSettings(process.cwd());
      console.log(`${ui.green('✔')} VS Code configurado: ${psbs.findProjectRoot(process.cwd()) ? 'los .pss' : 'los .txt'} de esta carpeta se abren como PuzzleScript.`);
      return;
    }

    case 'dev': {
      const { file, psbsRoot } = await resolveGame(args._[1]);
      const { startServer } = require('../lib/server');
      await startServer({ file, port: args.port, open: args.open ? (args.editor ? '' : 'play') : false, psbsRoot });
      return;
    }

    case 'check': {
      const { file, psbsRoot } = await resolveGame(args._[1]);
      const { compileSource } = require('../lib/engine-node');
      const text = fs.readFileSync(file, 'utf8');
      const r = compileSource(text);
      ui.printResult(path.resolve(file), r, null, mapperFor(psbsRoot, text));
      process.exit(r.ok ? 0 : 1);
      return;
    }

    case 'build': {
      const { file, psbsRoot } = await resolveGame(args._[1]);
      const { compileSource } = require('../lib/engine-node');
      const { buildStandaloneHtml } = require('../lib/build');
      const text = fs.readFileSync(file, 'utf8');
      const r = compileSource(text);
      ui.printResult(path.resolve(file), r, null, mapperFor(psbsRoot, text));
      if (!r.ok) die('No se exporta: corregí los errores primero.');
      const safe = (r.title || (psbsRoot ? path.basename(psbsRoot) : path.basename(file, path.extname(file)))).replace(/[\\/:*?"<>|]+/g, '').trim() || 'game';
      const out = args.out || path.join(psbsRoot || '.', 'dist', safe + '.html');
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, buildStandaloneHtml(text, r));
      console.log(`${ui.green('✔')} Exportado: ${ui.bold(out)}`);
      return;
    }

    case 'vscode': {
      require('../lib/vscode-install').install();
      return;
    }

    default:
      ui.error(`Comando desconocido: ${cmd}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((e) => die(e && e.stack ? e.stack : String(e)));
