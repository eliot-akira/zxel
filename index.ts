import fs from 'node:fs'
import { inspect as _inspect } from 'node:util'
import * as emphasize from 'emphasize'
import * as termKit from 'terminal-kit'
import * as zx from 'zx'

/**
 * ANSI Escape Sequences - https://gist.github.com/fnky/458719343aabd01cfb17a3a4f7296797
 */

const args = process.argv.slice(2)
const version = '0.0.5'

const inspectOptions = {
  colors: true,
  depth: Infinity,
}
const inspect = (value) => _inspect(value, inspectOptions)

const debugStream =
  process.env.NODE_ENV === 'development'
    ? fs.createWriteStream('debug.txt')
    : {
        write() {},
        close() {},
      }

const run = async (code: string) => {
  const result = await eval(`(async function() { ${code} }).bind(global)()`)
  // console.log(typeof result === 'object' ? inspect(result) : result)
  return result
}

function runCode(code: string) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout')), 3000)
    // TODO: Parse code and determine if code has valid syntax for expression

    ;(async () => {
      const isExpression = !code.includes(';')

      try {
        const result = await run(isExpression ? `return ${code}` : code)
        clearTimeout(timer)
        resolve(result)
      } catch (e) {
        if (!isExpression) {
          clearTimeout(timer)
          reject(e)
          return
        }
        // Check if syntax error?
        // console.log(e)
        run(code)
          .then(resolve)
          .catch(reject)
          .finally(() => clearTimeout(timer))
      }
    })().catch(console.error)
  })
}

/**
 * Detect environment
 * Reference: https://github.com/muratersin/detect-run-env
 */
const userAgent = (() => {
  if (typeof window === 'undefined') return undefined
  const ua = window?.navigator?.userAgent ?? ''
  if (ua !== '') {
    return ua.includes('Deno') ? undefined : ua
  }
  return undefined
})()

const getProcess = () => {
  try {
    return !userAgent && typeof process !== 'undefined' ? process : {}
  } catch (err) {
    return {}
  }
}

export const bunVersion = getProcess()?.versions?.bun
export const isBun = Boolean(bunVersion)
export const denoVersion =
  // eslint-disable-next-line no-undef
  typeof Deno !== 'undefined' ? Deno?.version?.deno : undefined
export const isDeno = Boolean(denoVersion) && !isBrowser
export const nodeVersion =
  isBun || isDeno ? undefined : getProcess()?.versions?.node
export const isNode = Boolean(nodeVersion) && !isBun && !isDeno

async function prepareRuntime() {
  Object.assign(globalThis, zx, {
    /**
     * Manually pipe key inputs because zx.$ does something to stdin that stops keypress
     * events after it exists.
     */
    $: async function (pieces: TemplateStringsArray, ...args: any[]) {
      const p = zx
        .$(pieces, ...args)
        .nothrow()
        .timeout('5s')
        .stdio('pipe', 'pipe', 'pipe')
        .quiet()

      // bypassKeyPress = function (key) {
      //   console.log('Pass to $ process', key)
      // }

      const result = await p

      // bypassKeyPress = null

      // Return error instead of throw, to keep REPL alive
      if (result.exitCode) {
        return new Error(result.stderr || `Exit code ${result.exitCode}`)
      }

      return result.stdout.trim()
    },
    $see: async function (pieces: TemplateStringsArray, ...args: any[]) {
      const p = zx
        .$(pieces, ...args)
        .nothrow()
        .timeout('5s')
        .stdio('pipe', 'pipe', 'pipe')

      // bypassKeyPress = function (key) {
      //   console.log('Pass to $ process', key)
      // }

      const result = await p

      // bypassKeyPress = null

      // Return error instead of throw, to keep REPL alive
      if (result.exitCode) {
        return new Error(result.stderr || `Exit code ${result.exitCode}`)
      }
      return result.toString().trim()
    },

    inspect,
    log: console.log,
    globDir: (pattern: string, options = {}) =>
      zx.glob(pattern, {
        onlyDirectories: true,
        ...options,
      }),
    exit: () => process.exit(),

    ...(isBun ? Object.assign({}, await import('bun:sqlite')) : {}),
  })

  // First command can return empty
  globalThis.$``
}

const emph = emphasize.createEmphasize(emphasize.common)

debugStream.write('\n')

process.on('beforeExit', () => {
  debugStream.close()
})

// https://github.com/cronvel/terminal-kit/blob/master/doc/documentation.md
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

const history = []
let historyCursor = 0

function setPrompt(str) {
  prompt = str
  promptLength = termKit.stringWidth(str)
}

async function showPrompt() {
  // term('\n')
  Object.assign(startPosition, await term.getCursorLocation())

  // Remember position before prompt start
  // term(JSON.stringify({ x, y }) + '\n')
  debugStream.write('Prompt start: ' + JSON.stringify(startPosition) + '\n')

  term(prompt)

  Object.assign(endPosition, {
    x: startPosition.x + promptLength,
    y: startPosition.y,
  })

  bufferCursorIndex = 0
  // console.log(name, data, term.width, 'x', term.height, `(${x}, ${y})`)
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

  // 0 = startPosition(x, y)
  // buffer.length = endPosition(x, y)

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

  //   debugStream.write(`Cursor from index: ${index} = (${col} / ${term.width}, ${row}) = [${
  //   startPosition.x + col
  // }, ${ startPosition.y + row }]`)

  return cursor
}

async function updateLine() {
  const output = buffer ? emph.highlight('js', buffer).value : ''

  // * .eraseArea(x,y,[width],[height]): a handy higher level method that erases a rectangular
  term.eraseArea(
    startPosition.x,
    startPosition.y,
    term.width,
    endPosition.y - startPosition.y + 1,
  )

  term.hideCursor(true)
  term.moveTo(startPosition.x, startPosition.y)
  term(`\r${prompt}${output}`)

  // term.put({
  //   ...startPosition,
  //   markup: 'ansi'
  // }, `\r${prompt}${output}`)

  /**
   * Detect if scrolled up at the bottom of screen, and adjust startPosition Y
   */

  const relativeEndPosition = calculateCursorPosition(buffer.length, true)
  const endRow = startPosition.y + relativeEndPosition.y
  if (endRow >= term.height) {
    const diff = term.height - endRow
    debugStream.write(`Scroll: ${diff}\n`)
    startPosition.y += diff

    /**
     * Handle edge case when the cursor is after the last character
     * of the end of line at the bottom of screen, it should be shown
     * at the start of an empty line - instead of start of current line.
     */
    if (diff === -1 && relativeEndPosition.x === 0) {
      term('\n')
    }
  }

  Object.assign(endPosition, await term.getCursorLocation())

  debugStream.write(
    'DRAW ' +
      JSON.stringify(startPosition) +
      ' ~ ' +
      JSON.stringify(endPosition) +
      '\n',
  )

  const cursor = calculateCursorPosition()

  term.moveTo(cursor.x, cursor.y)
  term.hideCursor(false)

  debugStream.write(
    'CURSOR ' +
      JSON.stringify(calculateCursorPosition()) +
      ' = ' +
      JSON.stringify(bufferCursorIndex) +
      '\n',
  )
}

function clearScreen() {
  term.clear()
  Object.assign(startPosition, { x: 1, y: 1 })
  updateLine()
}

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

  debugStream.write(JSON.stringify([name, data]) + '\n')

  switch (name) {
    case 'CTRL_C':
      term('\n')
      process.exit()
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
        term.moveTo(cursor.x, cursor.y)
      }
      term('\n')

      if (buffer === 'help') {
        console.log(`Available commands`)
        console.log(`clear - Clear screen`)
        console.log(`exit - Exit`)
        console.log(`help - Show this help screen`)
        buffer = ''
        showPrompt()
        return
      } else if (buffer === 'clear') {
        buffer = ''
        bufferCursorIndex = 0
        clearScreen()
        return
      } else if (buffer === 'exit') {
        process.exit()
        return
      }

      // console.log('Run:', buffer)
      history.push(buffer)
      history.splice(100, history.length - 100)
      historyCursor = history.length

      debugStream.write(`EVAL: ${buffer}\n`)
      // debugStream.write(`HISTORY: ${JSON.stringify(history)}\n`)

      try {
        const result = await runCode(buffer)
        if (result) {
          // term(result + '\n')
          console.log(typeof result === 'object' ? inspect(result) : result)
        }
      } catch (e) {
        term.red(e.message + '\n')
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
      debugStream.write(
        `DOWN: ${historyCursor + 1} ? ${history[historyCursor + 1]}\n`,
      )

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
        debugStream.write(`LEFT: ${JSON.stringify(cursor)}\n`)
      }
      break

    case 'RIGHT':
      if (bufferCursorIndex < buffer.length) {
        bufferCursorIndex++
        // updateLine()
        const cursor = calculateCursorPosition()
        term.moveTo(cursor.x, cursor.y)
        debugStream.write(`RIGHT: ${JSON.stringify(cursor)}\n`)
      }
      break

    case 'CTRL_LEFT':
    case 'CTRL_A':
      {
        bufferCursorIndex = 0
        const cursor = calculateCursorPosition()
        term.moveTo(cursor.x, cursor.y)
      }
      break
    case 'CTRL_RIGHT':
    case 'CTRL_E':
      {
        bufferCursorIndex = buffer.length
        const cursor = calculateCursorPosition()
        term.moveTo(cursor.x, cursor.y)
      }
      break
    case 'CTRL_R':
      clearScreen()
      break

    default:
      break
  }
  if (name === 'CTRL_C') process.exit()

  // console.log(JSON.stringify({ name, ...data }))
  // term.getCursorLocation().then(({ x, y }) => {
  //   console.log(name, data, term.width, 'x', term.height, `(${x}, ${y})`)
  // })
})

setPrompt('\x1B[033\x1B[34mzx\x1B[30m>\x1B[00m ')

console.log(
  `\x1b[1;32mzxel\x1b[1;37m ${version} - Interactive JavaScript runtime shell`,
)
console.log(
  'Enter code to run, or "help" to see commands\nAssign variables like: this.a = 123\x1B[00m',
)

prepareRuntime().then(() => {
  term.grabInput(true)
  showPrompt()
})
