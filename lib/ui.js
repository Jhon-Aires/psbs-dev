'use strict';
const path = require('path');
const { spawn } = require('child_process');

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code) => (s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const red = c('31'), yellow = c('33'), green = c('32'), dim = c('2'), bold = c('1'), cyan = c('36');

function time() {
  return dim(new Date().toLocaleTimeString());
}

function rel(file) {
  const r = path.relative(process.cwd(), file);
  return r && !r.startsWith('..') ? r : file;
}

/** Prints compile results as `file:line: error: message` (clickable in most terminals/VS Code). */
function printResult(file, r, label, mapLine) {
  const f = rel(file);
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  for (const i of r.issues) {
    const mapped = mapLine && i.line ? mapLine(i.line) : null;
    const loc = mapped ? `${mapped} ${dim('(' + f + ':' + i.line + ')')}` : i.line ? `${f}:${i.line}` : f;
    const tag = i.severity === 'error' ? red('error') : yellow('aviso');
    console.log(`  ${loc}: ${tag}: ${i.message}`);
  }
  const head = label ? `${time()} ${dim('[' + label + ']')}` : time();
  if (errors.length) {
    console.log(`${head} ${red('✖')} ${errors.length} error(es)` + (warnings.length ? `, ${warnings.length} aviso(s)` : ''));
  } else {
    const t = r.title ? bold(r.title) + ' — ' : '';
    console.log(`${head} ${green('✔')} ${t}${r.levels} nivel(es)` + (warnings.length ? `, ${yellow(warnings.length + ' aviso(s)')}` : ''));
  }
}

function ready(file, url) {
  console.log('');
  console.log(`  ${bold('psbs-dev')}  ${dim('vigilando')} ${rel(file) || '.'}`);
  console.log(`  ${dim('editor + juego:')} ${cyan(url)}`);
  console.log(`  ${dim('solo el juego:')}  ${cyan(url + 'play')}`);
  console.log(`  ${dim('Ctrl+C para salir')}`);
  console.log('');
}

function info(msg) { console.log(`${time()} ${msg}`); }
function warn(msg) { console.log(`${time()} ${yellow(msg)}`); }
function error(msg) { console.error(red(msg)); }

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const p = spawn(cmd, args, { stdio: 'ignore', detached: true });
    p.on('error', () => {});
    p.unref();
  } catch { /* ignore: user can open the URL manually */ }
}

module.exports = { printResult, ready, info, warn, error, openBrowser, red, green, yellow, dim, bold, cyan, rel };
