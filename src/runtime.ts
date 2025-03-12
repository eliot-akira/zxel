import path from 'path'
import { spawn } from 'child_process'
import * as zx from 'zx'
import { inspect } from './common'

/**
 * Runtime environment
 */
export const isBun: boolean = !!globalThis.Bun
export const isDeno: boolean = !!globalThis.Deno
export const isNode: boolean = Boolean(
  globalThis.process?.versions?.node && !isBun
)
export const isBrowser: boolean = globalThis.window && !isDeno
export let currentRuntime: 'bun' | 'deno' | 'node' | 'browser' | 'unknown'
switch (true) {
  case isBun:
    currentRuntime = 'bun'
    break
  case isDeno:
    currentRuntime = 'deno'
    break
  case isNode:
    currentRuntime = 'node'
    break
  case isBrowser:
    currentRuntime = 'browser'
    break
  default:
    currentRuntime = 'unknown'
    break
}
export const runtimeValue = <T>(
  v: Partial<{ bun: T; deno: T; node: T; browser: T; default: T }>
): T | undefined => v[currentRuntime] ?? v.default

export const run = async (code: string) => {
  // Put code in its own line to support comment
  return await eval(`(async function() {
${code}
}).bind(global)()`)
}

export function runCode(code: string, timeout = 0) {
  return new Promise((resolve, reject) => {
    // Optional timeout
    let timer
    if (timeout) {
      timer = setTimeout(() => reject(new Error('Timeout')), timeout)
    }

    ;(async () => {
      /**
       * TODO: Parse code and determine if code has valid syntax for expression
       * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements
       */
      const isExpression = !code.match(
        /;|\n|const |for |if |let |var |while |try /g
      )

      try {
        const result = await run(isExpression ? `return ${code}` : code)
        timer && clearTimeout(timer)
        resolve(result)
      } catch (e) {
        if (isExpression && e instanceof SyntaxError) {
          return run(code)
            .then(resolve)
            .catch(reject)
            .finally(() => timer && clearTimeout(timer))
        } else {
          timer && clearTimeout(timer)
          reject(e)
          return
        }
      }
    })().catch(console.error)
  })
}

export async function prepareRuntime() {
  const home = zx.os.homedir()

  // Load Bash aliases - https://google.github.io/zx/faq#attaching-a-profile
  // zx.$.prefix += `source ~/.bash_aliases; `

  const runtimeContext = Object.assign({}, zx, {
    /**
     * Manually pipe key inputs because zx.$ does something to stdin that stops keypress
     * events after it exists.
     */
    $: async function (pieces: TemplateStringsArray, ...args: any[]) {
      if (pieces[0].startsWith('cd ')) {
        // See cd() below
        return globalThis.cd(pieces[0].slice(3))
      }

      const p = zx
        .$(pieces, ...args)
        .nothrow()
        // .timeout('5s')
        .stdio('pipe', 'pipe', 'pipe')
        .quiet()

      const result = await p

      // Return error instead of throw, to keep REPL alive
      if (result.exitCode) {
        throw new Error(result.stderr || `Exit code ${result.exitCode}`)
      }

      return result.stdout.trim()
    },
    $see: async function (pieces: TemplateStringsArray, ...args: any[]) {
      if (typeof pieces === 'string') {
        // Handle when called like $see('..') instead of $see``
        pieces = [pieces]
      }
      const p = zx
        .$(pieces, ...args)
        .nothrow()
        // .timeout('5s')
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
    cd(str: string | string[], ...args: string[]) {
      // Template tag cd``
      if (Array.isArray(str)) {
        str = str.reduce(
          (prev, now, index) => prev + now + (args[index] ?? ''),
          ''
        )
      }
      if (str==='~') {
        str = home
      } else if (str.startsWith('~/')) {
        str = str.replace(/^~\//, home + '/')
      }

      const absPath =
        str.startsWith('/') || str.startsWith('~')
          ? str
          : path.join(process.cwd(), str)

      // For commands like fs.*
      process.chdir(absPath)
      // For commands run with $`..`
      zx.cd(absPath)
      return
    },
    exit: () => process.exit(),
    fetch: globalThis.fetch || zx.fetch,
    home,
    inspect,
    log: console.log,
    globDir: (pattern: string, options = {}) =>
      zx.glob(pattern, {
        onlyDirectories: true,
        ...options,
      }),
    spawn(command, ...args: string[]) {
      // Create detached child process that will continue to run after parent exits
      const child = spawn(command, args, {
        detached: true,
        stdio: 'inherit',
      })
      child.unref()
    },
  })

  // TODO: Run in isolated context with long-running worker
  Object.assign(globalThis, runtimeContext)

  // First command can return empty
  globalThis.$``
}
