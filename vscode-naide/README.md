# NAIDE Language Support for VS Code

Syntax highlighting and language support for **NAIDE** (`.naide`) files.

## Features

- Syntax highlighting for all NAIDE keywords, types, and operators
- String interpolation highlighting (`"Hello {name}"`)
- Auto-indentation for block structures
- Bracket matching and auto-closing
- Comment toggling (`#`)

## File Associations

| Extension | Language |
|-----------|----------|
| `.naide`  | NAIDE    |

## Install

### From VSIX (local)

```bash
cd vscode-naide
npm install -g @vscode/vsce
vsce package
code --install-extension naide-lang-2.0.2.vsix
```

### Manual

Copy `vscode-naide/` to `~/.vscode/extensions/naide-lang/` and restart VS Code.

## About NAIDE

NAIDE is a programming language with one readable syntax, built-in diagnostics, and compiler targets. See [github.com/irxk/naide](https://github.com/irxk/naide).
