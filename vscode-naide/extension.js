const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const vscode = require('vscode');
const path = require('path');

let client;

function activate(context) {
  const config = vscode.workspace.getConfiguration('naide');
  const customPath = config.get('lsp.path');
  const naidePath = customPath || 'naide';

  const serverOptions = {
    command: naidePath,
    args: ['lsp'],
    transport: TransportKind.stdio,
  };

  const clientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'naide' },
      { scheme: 'file', language: 'naidex' },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.{naide,nx}'),
    },
  };

  client = new LanguageClient('naide', 'NAIDE Language Server', serverOptions, clientOptions);
  client.start().catch(() => {
    vscode.window.showInformationMessage(
      'NAIDE LSP not available. Install naider globally (npm i -g naider) for diagnostics and autocomplete.'
    );
  });
}

function deactivate() {
  if (!client) return undefined;
  return client.stop();
}

module.exports = { activate, deactivate };
