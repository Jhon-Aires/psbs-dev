// psbs bridge: connects the official PuzzleScript editor to a file on disk.
// Loaded after all editor scripts, so editor globals (editor, compile, curlevel,
// titleScreen, setEditorClean, consolePrint...) are in scope.
(function () {
  'use strict';

  var fileName = 'game.txt';
  var levels = 0;
  var connected = false;
  var readonly = false;

  // ---- status badge in the toolbar ----
  var badge = document.createElement('span');
  badge.id = 'psbs-badge';
  badge.title = 'psbs: sincronizado con el archivo en disco';
  var toolbar = document.getElementById('uppertoolbar') || document.body;
  toolbar.appendChild(badge);

  // Things that would silently replace your file's content (or need puzzlescript.net)
  // are hidden: loading localStorage saves/examples into an editor wired to disk is a
  // footgun, and SHARE needs a GitHub login on puzzlescript.net.
  ['loadDropDown', 'exampleDropdown', 'shareClickLink'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var target = el.tagName === 'SELECT' ? el.form : el;
    target.style.display = 'none';
    var sep = target.nextSibling; // trailing " - " separator text
    if (sep && sep.nodeType === 3) sep.textContent = sep.textContent.replace(/^\s*-\s*/, ' ');
  });
  function setBadge(state, text) {
    badge.className = 'psbs-' + state;
    badge.textContent = text;
  }
  setBadge('wait', 'psbs: conectando…');

  function println(html) {
    try { consolePrint('<span class="psbsMessage">' + html + '</span>', true); } catch (e) { /* console not ready */ }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isInLevel() {
    try { return !titleScreen && typeof curlevel === 'number' && levels > 0; } catch (e) { return false; }
  }

  // Replace editor text keeping cursor/scroll, then recompile on the same level.
  function applyText(text, levelCount, errorCount, fromBrowser) {
    levels = levelCount;
    if (!fromBrowser && text !== editor.getValue()) {
      var cursor = editor.getCursor();
      var scroll = editor.getScrollInfo();
      editor.setValue(text);
      editor.setCursor(cursor);
      editor.scrollTo(scroll.left, scroll.top);
    }
    setEditorClean();
    // If the previous save had errors we were sent to the title screen; remember
    // which level you were on so fixing the error takes you straight back.
    var target = isInLevel() ? curlevel : pendingLevel;
    clearConsole();
    if (errorCount > 0) {
      pendingLevel = target;
      compile(['restart']); // shows the errors in the console
      println('✖ hay errores; al corregirlos volvés al nivel en el que estabas');
      return;
    }
    pendingLevel = null;
    if (target !== null && target !== undefined && levels > 0) {
      var lvl = Math.max(0, Math.min(target, levels - 1));
      compile(['loadLevel', lvl]);
      println('↻ recargado desde ' + escapeHtml(fileName) + ' (mismo nivel)');
    } else {
      compile(['restart']);
      println('↻ recargado desde ' + escapeHtml(fileName));
    }
  }
  var pendingLevel = null;

  // ---- live updates from disk ----
  function connect() {
    var es = new EventSource('/__psbs/events');
    es.onopen = function () { connected = true; setBadge('ok', '● ' + fileName); };
    es.onerror = function () {
      connected = false;
      setBadge('off', '○ psbs desconectado (¿cerraste la terminal?)');
    };
    es.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'build-error') {
        clearConsole();
        println('<span style="color:#ff8a80">✖ psbs build falló:</span><br>' + escapeHtml(msg.message).replace(/\n/g, '<br>'));
        return;
      }
      if (msg.type === 'hello') {
        readonly = !!msg.readonly;
        fileName = msg.name;
        levels = msg.levels;
        document.title = fileName + ' — psbs';
        setBadge('ok', '● ' + fileName);
        return;
      }
      if (msg.type === 'goto') {
        compile(['levelline', msg.line]);
        return;
      }
      if (msg.type !== 'change') return;
      if (msg.source === 'browser') return; // we already have it
      if (_editorDirty && msg.text !== editor.getValue()) {
        var keep = !confirm(fileName + ' cambió en disco y tenés cambios sin guardar en el navegador.\n\nAceptar: usar la versión del disco.\nCancelar: mantener la del navegador (Ctrl+S la guarda en disco).');
        if (keep) return;
      }
      applyText(msg.text, msg.levels, msg.errors, false);
      flash();
    };
  }

  function flash() {
    badge.classList.add('psbs-flash');
    setTimeout(function () { badge.classList.remove('psbs-flash'); }, 400);
  }

  // ---- Save (button + Ctrl/Cmd+S) writes to disk ----
  function saveToDisk() {
    var text = editor.getValue();
    if (readonly) {
      alert('Este juego lo genera PSBS a partir de src/*.pss.\nEditá esos archivos: cada vez que guardás se recompila solo.');
      return;
    }
    if (!connected) {
      alert('psbs no está corriendo: no se puede guardar en disco.\nVolvé a ejecutar "psbs dev" en la terminal.');
      return;
    }
    fetch('/__psbs/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    }).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      levels = res.levels;
      setEditorClean();
      println('💾 guardado en ' + escapeHtml(fileName));
      flash();
    }).catch(function (e) {
      alert('No se pudo guardar: ' + e.message);
    });
  }
  window.saveClick = saveToDisk;
  // eslint-disable-next-line no-global-assign
  saveClick = saveToDisk; // inputoutput.js calls saveClick() by name on Ctrl+S
  var oldLink = document.getElementById('saveClickLink');
  if (oldLink) {
    var link = oldLink.cloneNode(true); // drops the original listener (localStorage save)
    oldLink.parentNode.replaceChild(link, oldLink);
    link.addEventListener('click', saveToDisk);
  }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      e.stopPropagation();
      saveToDisk();
    }
  }, true);

  connect();
})();
