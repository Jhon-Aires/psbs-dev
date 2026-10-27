#!/usr/bin/env node
'use strict';
// Packages the VS Code extension (vscode/) into vscode/puzzlescript-psbs.vsix,
// bundling the engine files the extension needs to compile games.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'vscode');

fs.rmSync(path.join(EXT, 'engine'), { recursive: true, force: true });
fs.mkdirSync(path.join(EXT, 'engine', 'js', 'codemirror'), { recursive: true });
const src = fs.readFileSync(path.join(ROOT, 'lib', 'engine-node.js'), 'utf8');
const files = [...src.matchAll(/'(js\/[^']+\.js)'/g)].map((m) => m[1]);
for (const f of files) fs.copyFileSync(path.join(ROOT, 'engine', f), path.join(EXT, 'engine', f));
fs.copyFileSync(path.join(ROOT, 'engine', 'VERSION'), path.join(EXT, 'engine', 'VERSION'));
for (const lib of ['engine-node.js', 'psbs-project.js']) fs.copyFileSync(path.join(ROOT, 'lib', lib), path.join(EXT, lib));
console.log(`copied ${files.length} engine files`);

execSync('npx --yes @vscode/vsce@latest package --no-dependencies --allow-missing-repository -o puzzlescript-psbs.vsix', { cwd: EXT, stdio: 'inherit' });
