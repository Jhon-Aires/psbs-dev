'use strict';
// Minimal stand-in for the `vscode` API so the extension's providers can be
// exercised from Node in tests (no editor needed).
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; } else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
}
class Location { constructor(uri, r) { this.uri = uri; this.range = r instanceof Position ? new Range(r, r) : r; } }
class MarkdownString { constructor(v) { this.value = v; } }
class Hover { constructor(c, r) { this.contents = [c]; this.range = r; } }
class CompletionItem { constructor(label, kind) { this.label = label; this.kind = kind; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class DocumentSymbol { constructor(name, detail, kind, range, sel) { Object.assign(this, { name, detail, kind, range, selectionRange: sel, children: [] }); } }
class Color { constructor(r, g, b, a) { Object.assign(this, { red: r, green: g, blue: b, alpha: a }); } }
class ColorInformation { constructor(range, color) { this.range = range; this.color = color; } }
class ColorPresentation { constructor(label) { this.label = label; } }
class CodeLens { constructor(range, command) { this.range = range; this.command = command; } }
class WorkspaceEdit { constructor() { this.edits = []; } replace(uri, range, text) { this.edits.push({ uri, range, text }); } }
class EventEmitter { constructor() { this.event = () => ({ dispose() {} }); } fire() {} }

const providers = {};
const reg = (name) => (sel, p) => { providers[name] = p; return { dispose() {} }; };
const diagnostics = new Map();

function makeDoc(text, fsPath) {
  const lines = text.split('\n');
  return {
    uri: { toString: () => 'file://' + fsPath, fsPath },
    languageId: 'puzzlescript', version: 1, isDirty: false,
    getText: () => text, lineCount: lines.length,
    lineAt: (i) => ({ text: lines[i], firstNonWhitespaceCharacterIndex: lines[i].search(/\S|$/) }),
  };
}

module.exports = {
  providers, diagnostics, makeDoc,
  Position, Range, Location, MarkdownString, Hover, CompletionItem, Diagnostic, DocumentSymbol, Color,
  ColorInformation, ColorPresentation, CodeLens, WorkspaceEdit, EventEmitter,
  CompletionItemKind: new Proxy({}, { get: (_, k) => k }),
  SymbolKind: new Proxy({}, { get: (_, k) => k }),
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  StatusBarAlignment: { Left: 1 }, ViewColumn: { Beside: -2 },
  Uri: { parse: (s) => ({ s }), file: (f) => ({ fsPath: f, toString: () => 'file://' + f }) },
  env: { openExternal() {} },
  commands: { registerCommand: () => ({ dispose() {} }), executeCommand: () => Promise.resolve() },
  window: {
    createStatusBarItem: () => ({ show() {}, hide() {}, dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }), activeTextEditor: null,
    showWarningMessage() {}, showErrorMessage() {}, createTerminal: () => ({ show() {}, sendText() {} }),
  },
  workspace: {
    textDocuments: [],
    onDidSaveTextDocument_: null,
    onDidOpenTextDocument: () => ({ dispose() {} }), onDidChangeTextDocument: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }), onDidCloseTextDocument: () => ({ dispose() {} }),
  },
  languages: {
    createDiagnosticCollection: () => ({ set: (u, d) => diagnostics.set(u.toString(), d), delete() {}, dispose() {} }),
    registerCompletionItemProvider: reg('completion'), registerHoverProvider: reg('hover'),
    registerDefinitionProvider: reg('definition'), registerReferenceProvider: reg('references'),
    registerRenameProvider: reg('rename'), registerDocumentSymbolProvider: reg('symbols'),
    registerColorProvider: reg('color'), registerCodeLensProvider: reg('codelens'),
  },
};
