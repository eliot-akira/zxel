# zxel

`zxel` is an interactive terminal shell with `zx` utilities and syntax highlight for JavaScript runtimes (Node/Bun).

![Screenshot](screenshot.png)

## Features

- Read-eval-print-loop of JavaScript expression with syntax highlight
- Top-level `await`
- Keyboard shortcuts
  - Cursor left/right, Backspace, Delete
  - Move to start/end of line with CTRL+LEFT (or CTRL+A) and CTRL+RIGHT (or CTRL+E)
  - Navigate history with cursor up/down
  - CTRL+R to clear screen
- Globals from [`zx`](https://google.github.io/zx/api)
  - `$` (shell with return value)
  - `$see` (shell with output)
  - `fs`
  - `glob`
- Runs with [Bun](https://bun.sh/) if installed
  - `Bun`
  - `Database`
