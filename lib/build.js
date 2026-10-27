'use strict';
// Builds a single self-contained HTML file for a game, using the same template
// as the official editor's "export" button.

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, '..', 'engine', 'standalone_inlined.txt');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

const HOT_RELOAD_SNIPPET = `
<script>
(function () {
  // psbs: hot reload for the standalone player
  var text = sourceCode, levels = 0, pending = null;
  var es = new EventSource('/__psbs/events');
  function focusGame() { try { window.focus(); canvas.focus(); } catch (e) {} }
  es.onmessage = function (ev) {
    var msg = JSON.parse(ev.data);
    if (msg.type === 'hello') { levels = msg.levels; return; }
    if (msg.type === 'goto') {
      compile(['levelline', msg.line], text);
      focusGame();
      return;
    }
    if (msg.type !== 'change') return;
    text = msg.text; levels = msg.levels;
    var target = !titleScreen ? curlevel : pending;
    if (msg.errors > 0) { pending = target; return; } // keep playing the last good version
    pending = null;
    if (target !== null && levels > 0) compile(['loadLevel', Math.min(target, levels - 1)], text);
    else compile(['restart'], text);
  };
})();
</script>
`;

function buildStandaloneHtml(sourceText, compiled, opts) {
  opts = opts || {};
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  const meta = (compiled && compiled.metadata) || {};
  const title = meta.title || 'PuzzleScript Game';
  let homepage = meta.homepage || 'https://www.puzzlescript.net';
  if (!/^https?:\/\//.test(homepage)) homepage = 'https://' + homepage;
  const homepageStripped = escapeHtml(homepage.replace(/^https?:\/\//, ''));
  const bg = 'background_color' in meta && compiled.bgcolor ? compiled.bgcolor : 'black';
  const fg = 'text_color' in meta && compiled.fgcolor ? compiled.fgcolor : 'lightblue';

  // Use split/join instead of String.replace to avoid "$" substitution surprises.
  const sub = (s, token, value) => s.split(token).join(value);
  html = sub(html, '___BGCOLOR___', bg);
  html = sub(html, '___TEXTCOLOR___', fg);
  html = sub(html, '__GAMETITLE__', escapeHtml(title));
  html = sub(html, '__HOMEPAGE_STRIPPED_PROTOCOL__', homepageStripped);
  html = sub(html, '__HOMEPAGE__', homepage);
  // JSON.stringify gives a valid JS string literal; also guard against "</script>".
  const literal = JSON.stringify(sourceText).replace(/<\/(script)/gi, '<\\/$1');
  html = sub(html, '"__GAMEDAT__"', literal);
  if (opts.hotReload) {
    html = html.replace(/(<\/body>)(?![\s\S]*<\/body>)/, HOT_RELOAD_SNIPPET + '$1');
  }
  return html;
}

module.exports = { buildStandaloneHtml };
