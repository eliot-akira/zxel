import os from 'node:os'
import * as emphasize from 'emphasize'
import * as termKit from 'terminal-kit'
import { runCode } from './runtime'
import { log, inspect } from './common'

/**
 * Terminal screen
 * https://github.com/cronvel/terminal-kit/blob/master/doc/documentation.md
 */
export async function startTerminal({ version, history = [], pushHistory }) {
  // Syntax highlighter
  const emph = emphasize.createEmphasize(emphasize.common)

  // Support hot-reloading during dev
  let term = globalThis.term
  if (term) {
    term.removeAllListeners()
  } else {
    term = globalThis.term = termKit.terminal
  }

  // term.on('resize', (width, height) => {
  //   console.log('resize', width, height)
  // })

  let buffer = ''
  let startPosition = { x: 0, y: 0 }
  let endPosition = { x: 0, y: 0 }
  let bufferCursorIndex = 0

  let prompt = ''
  let promptLength = 0

  let historyCursor = history.length

  const home = os.homedir()

  function setPrompt(str) {
    prompt = str
    promptLength = termKit.stringWidth(str)
  }

  function getPrompt() {
    // Show current working directory
    let relativeCwd = process.cwd()
    if (relativeCwd.startsWith(home)) {
      relativeCwd = relativeCwd.replace(home, '~')
    }
    prompt = `\x1B[033\x1B[34mzx\x1B[30m>\x1B[00m `
    // With current working directory
    // prompt = `\x1B[033\x1B[34mzx\x1B[30m:${relativeCwd}>\x1B[00m `
    promptLength = termKit.stringWidth(prompt)

    return prompt
  }

  type CursorPosition = { x: number; y: number }

  let lastKnownPosition: CursorPosition = { x: 0, y: 0 }
  async function getCursorLocation(): Promise<CursorPosition> {
    // HACK: Workaround because getCursorLocation can throw error
    try {
      lastKnownPosition = await term.getCursorLocation()
    } catch (e) {
      // OK
    }
    return lastKnownPosition
  }

  async function showPrompt() {
    const prompt = getPrompt()

    // Remember position before prompt start
    Object.assign(startPosition, await getCursorLocation())

    // log('Prompt start: ' + JSON.stringify(startPosition) + '\n')

    const cusorVisible = '\x1b[?25h'

    term(cusorVisible + prompt)

    Object.assign(endPosition, {
      x: startPosition.x + promptLength,
      y: startPosition.y,
    })

    bufferCursorIndex = 0
  }

  function calculateCursorPosition(
    index: number = bufferCursorIndex,
    relative: boolean = false,
  ): {
    x: number
    y: number
  } {
    /**
     * Get cursor position from buffer cursor index
     * Note terminal position starts from [x = 1, y = 1]
     */

    // 0 === startPosition(x, y)
    // buffer.length === endPosition(x, y)

    index += promptLength

    const row = Math.floor(index / term.width)
    let col = index - term.width * row

    if (col < 0) col = 0

    let x = col
    let y = row

    if (!relative) {
      x += startPosition.x
      y += startPosition.y
    }

    const cursor = {
      x,
      y,
    }

    //   log(`Cursor from index: ${index} = (${col} / ${term.width}, ${row}) = [${
    //   startPosition.x + col
    // }, ${ startPosition.y + row }]`)

    return cursor
  }

  async function updateLine() {
    const output = buffer ? emph.highlight('js', buffer).value : ''

    term.hideCursor(true)

    // Erase current block
    term.eraseArea(
      1, // startPosition.x,
      startPosition.y,
      term.width,
      endPosition.y - startPosition.y + 1,
    )

    term.moveTo(startPosition.x, startPosition.y)
    term(`\r${prompt}${output}`)

    /**
     * Detect if scrolled up at the bottom of screen, and adjust startPosition Y
     */
    const relativeEndPosition = calculateCursorPosition(buffer.length, true)
    const endRow = startPosition.y + relativeEndPosition.y
    if (endRow >= term.height) {
      const diff = term.height - endRow
      startPosition.y += diff

      // log(`Scroll: ${diff}\n`)

      /**
       * Handle edge case when the cursor is after the last character
       * of the end of line at the bottom of screen, it should be shown
       * at the start of a new empty line, instead of start of current line.
       */
      if (diff === -1 && relativeEndPosition.x === 0) {
        term('\n')
      }
    }

    Object.assign(endPosition, await getCursorLocation())

    // log(`Draw ${JSON.stringify(startPosition)} ~ ${JSON.stringify(endPosition)}\n`)

    const cursor = calculateCursorPosition()

    term.moveTo(cursor.x, cursor.y)
    term.hideCursor(false)

    // log(`Cursor ${JSON.stringify(calculateCursorPosition())} = ${JSON.stringify(bufferCursorIndex)}\n`)
  }

  function clearScreen() {
    term.clear()
    Object.assign(startPosition, { x: 1, y: 1 })
    updateLine()
  }

  /**
   * Keypress
   */
  term.on('key', async (name, matches, data) => {
    if (data.isCharacter) {
      term(name)

      // Insert character at position
      // Previously appended: buffer += name

      buffer =
        buffer.slice(0, bufferCursorIndex) +
        name +
        buffer.slice(bufferCursorIndex)

      bufferCursorIndex++

      updateLine()
      return
    }

    // log(JSON.stringify([name, data]) + '\n')

    switch (name) {
      case 'CTRL_C':
        term('\n')
        // Cancel current line, or exit if empty line
        if (buffer.length) {
          buffer = ''
          showPrompt()
        } else {
          process.exit()
        }
        break

      case 'BACKSPACE':
        // Remove one character left of cursor, if any

        if (buffer[bufferCursorIndex - 1]) {
          buffer =
            buffer.slice(0, bufferCursorIndex - 1) +
            buffer.slice(bufferCursorIndex)
          bufferCursorIndex--
          updateLine()
        }

        break

      case 'DELETE':
        // Remove one character right of cursor, if any
        if (buffer[bufferCursorIndex]) {
          buffer =
            buffer.slice(0, bufferCursorIndex) +
            buffer.slice(bufferCursorIndex + 1)
          updateLine()
        }

        break

      case 'ENTER':
        // Move to end of buffer
        {
          const cursor = calculateCursorPosition(buffer.length)
          // term.moveTo(cursor.x, cursor.y)
          term.moveTo(1, cursor.y)
        }
        term('\r\n')

        // Built-in commands

        if (buffer === 'help') {
          console.log(`Available commands
  
clear - Clear screen
exit - Exit
help - Show this help screen
version - Show version

Documentation: https://github.com/eliot-akira/zxel`)
          buffer = ''
          showPrompt()
          return
        }
        if (buffer === 'clear') {
          buffer = ''
          bufferCursorIndex = 0
          clearScreen()
          return
        }
        if (buffer === 'exit') {
          process.exit()
          return
        }
        if (buffer === 'version') {
          console.log('Version', version)
          buffer = ''
          showPrompt()
          return
        }

        // History

        history.push(buffer)
        // Crop to max length
        history.splice(0, history.length - 100)
        historyCursor = history.length
        if (pushHistory) {
          pushHistory(buffer)
        }

        if (buffer.startsWith('$ ')) {
          // Shell command shortcut
          buffer = '$`' + buffer.slice(2) + '`'
        }

        // Run code

        // log(`EVAL: ${buffer}\n`)
        // log(`HISTORY: ${JSON.stringify(history)}\n`)

        try {
          const result = await runCode(buffer)
          if (result !== undefined) {
            console.log(typeof result === 'object' ? inspect(result) : result)
          }
        } catch (e) {
          term.red(e.message)
          term('\n')
        }
        buffer = ''
        showPrompt()
        break

      // Cursor
      case 'UP':
        if (historyCursor > 0 && history[historyCursor - 1]) {
          buffer = history[historyCursor - 1]
          historyCursor--
          bufferCursorIndex = buffer.length
          updateLine()
        }
        break
      case 'DOWN':
        // log(`DOWN: ${historyCursor + 1} ? ${history[historyCursor + 1]}\n`)

        if (history.length === 0) return

        if (history[historyCursor + 1]) {
          buffer = history[historyCursor + 1]
          historyCursor++
          bufferCursorIndex = buffer.length
        } else {
          historyCursor = history.length
          buffer = ''
          bufferCursorIndex = 0
        }
        updateLine()
        break
      case 'LEFT':
        if (bufferCursorIndex > 0) {
          bufferCursorIndex--
          // updateLine()
          const cursor = calculateCursorPosition()
          term.moveTo(cursor.x, cursor.y)
          // log(`LEFT: ${JSON.stringify(cursor)}\n`)
        }
        break

      case 'RIGHT':
        if (bufferCursorIndex < buffer.length) {
          bufferCursorIndex++
          // updateLine()
          const cursor = calculateCursorPosition()
          term.moveTo(cursor.x, cursor.y)
          // log(`RIGHT: ${JSON.stringify(cursor)}\n`)
        }
        break
      case 'CTRL_LEFT':
      case 'CTRL_B':
        // Backward one word
        if (bufferCursorIndex > 0) {
          const match = /([\w_-]+|\s+|[^A-Za-z0-9_\s]+)$/.exec(
            buffer.slice(0, bufferCursorIndex), // Match to the left only
          )
          if (match) {
            bufferCursorIndex = match.index
            // log(`FIND START OF WORD: ${JSON.stringify(match)}\nFrom: ${buffer.slice(match.index)}\n`)
          } else {
            // No word found
            bufferCursorIndex--
          }
          const cursor = calculateCursorPosition()
          term.moveTo(cursor.x, cursor.y)
        }
        break
      case 'CTRL_RIGHT':
      case 'CTRL_F':
        // Forward one word
        {
          let currentIndex = bufferCursorIndex
          const match = /^([\w_-]+|\s+|[^A-Za-z0-9_\s]+)/d.exec(
            buffer.slice(bufferCursorIndex), // Match to the right only
          )
          if (match && match.indices && match.indices[0]) {
            // log(`FIND END OF WORD: ${JSON.stringify(match.indices)}\nFrom: ${buffer.slice(match.index)}\n`)

            // Move to end of matched word
            const [start, end] = match.indices[0]
            bufferCursorIndex = bufferCursorIndex + end
          } else {
            // No word found
            if (bufferCursorIndex < buffer.length) {
              bufferCursorIndex++
            }
          }

          if (currentIndex !== bufferCursorIndex) {
            const cursor = calculateCursorPosition()
            term.moveTo(cursor.x, cursor.y)
          }
        }
        break

      case 'CTRL_A':
      case 'HOME':
        {
          bufferCursorIndex = 0
          const cursor = calculateCursorPosition()
          term.moveTo(cursor.x, cursor.y)
        }
        break
      case 'CTRL_E':
      case 'END':
        {
          bufferCursorIndex = buffer.length
          const cursor = calculateCursorPosition()
          term.moveTo(cursor.x, cursor.y)
        }
        break
      case 'CTRL_L': // Standard
      case 'CTRL_R': // Backward compatibility - Usually this is search
        clearScreen()
        break

      default:
        break
    }

    // log(JSON.stringify({ name, ...data }))
  })

  console.log(`\x1b[1;32mzxel\x1b[2;37m v${version}
\x1b[2;37mEnter code to run, "help" to see commands, or "exit"\x1B[0m`)

  term.grabInput(true)
  showPrompt()
}
