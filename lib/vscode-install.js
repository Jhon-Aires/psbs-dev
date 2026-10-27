'use strict';
// Installs the bundled VS Code extension (.vsix) into VS Code and compatible
// editors (Cursor, VSCodium) found on this machine.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ui = require('./ui');

const VSIX = path.join(__dirname, '..', 'vscode', 'puzzlescript-psbs.vsix');

function candidates() {
  const list = [
    { name: 'VS Code', cmd: 'code' },
    { name: 'Cursor', cmd: 'cursor' },
    { name: 'VSCodium', cmd: 'codium' },
  ];
  if (process.platform === 'darwin') {
    list.push(
      { name: 'VS Code', cmd: '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code' },
      { name: 'Cursor', cmd: '/Applications/Cursor.app/Contents/Resources/app/bin/cursor' },
      { name: 'VSCodium', cmd: '/Applications/VSCodium.app/Contents/Resources/app/bin/codium' },
    );
  }
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || '';
    list.push({ name: 'VS Code', cmd: path.join(local, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') });
  }
  return list;
}

function install() {
  if (!fs.existsSync(VSIX)) {
    ui.error('No encuentro la extensión empaquetada (vscode/puzzlescript-psbs.vsix).\nGenerala con: npm run build:vscode');
    process.exit(1);
  }
  const done = new Set();
  for (const c of candidates()) {
    if (done.has(c.name)) continue;
    if (path.isAbsolute(c.cmd) && !fs.existsSync(c.cmd)) continue;
    const r = spawnSync(c.cmd, ['--install-extension', VSIX, '--force'], {
      stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32',
    });
    if (r.error || r.status !== 0) continue;
    done.add(c.name);
    console.log(`${ui.green('✔')} Extensión instalada en ${ui.bold(c.name)}`);
  }
  if (!done.size) {
    ui.warn('No encontré VS Code en la terminal (comando "code").');
    console.log(`Instalala a mano: en VS Code → Extensiones → "…" → "Instalar desde VSIX…" y elegí:\n  ${VSIX}`);
    process.exit(1);
  }
  console.log(ui.dim('Si VS Code estaba abierto, recargá la ventana (Cmd/Ctrl+Shift+P → "Reload Window").'));
}

module.exports = { install, VSIX };
