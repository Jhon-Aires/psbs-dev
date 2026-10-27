#!/usr/bin/env node
// Test stand-in for `psbs build`: expands (% include "x" +%) in src/main.pss into bin/script.txt.
const fs = require('fs');
const path = require('path');
if (process.argv[2] === 'help') process.exit(0);
let src = fs.readFileSync('src/main.pss', 'utf8');
src = src.replace(/\(% include "([^"]+)" \+?%\)/g, (m, f) => {
  const p = path.join('src', f);
  if (!fs.existsSync(p)) { console.log('Error: template not found: ' + f); process.exit(1); }
  return fs.readFileSync(p, 'utf8').replace(/^\n+|\n+$/g, '');
});
fs.mkdirSync('bin', { recursive: true });
fs.writeFileSync('bin/script.txt', src + '\n');
console.log('Build complete!');
