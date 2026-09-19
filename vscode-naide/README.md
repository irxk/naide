# NAIDE Language Support for VS Code

Syntax highlighting and language support for **NAIDE** (`.naide`) and **NAIDE-X** (`.nx`) files.

## Features

- Syntax highlighting for all NAIDE keywords, types, and operators
- Syntax highlighting for NAIDE-X shorthand prefixes (`>`, `?`, `!`, `$`, `^`, `@`, etc.)
- String interpolation highlighting (`"Hello {name}"`)
- Auto-indentation for block structures
- Bracket matching and auto-closing
- Comment toggling (`#` for .naide, `--` for .nx)

## File Associations

| Extension | Language |
|-----------|----------|
| `.naide`  | NAIDE    |
| `.nx`     | NAIDE-X  |

## Install

### From VSIX (local)

```bash
cd vscode-naide
npm install -g @vscode/vsce
vsce package
code --install-extension naide-lang-1.0.0.vsix
```

### Manual

Copy `vscode-naide/` to `~/.vscode/extensions/naide-lang/` and restart VS Code.

## About NAIDE

NAIDE is an AI-optimized programming language that transpiles to Node.js. See [github.com/irxk/naide](https://github.com/irxk/naide).
