import path from 'node:path'
import url from 'node:url'
import { fs, glob } from 'zx'
import { zxelDir, dbPath, inspect } from './common'
import { prepareRuntime, runCode } from './runtime'
import { prepareDatabase } from './db'
import { startTerminal } from './terminal'

const dirname = path.dirname(url.fileURLToPath(import.meta.url))

async function getVersion() {
  // Find package.json - from src or build/esm
  let packagePath = path.join(dirname, '..', 'package.json')
  let version = (await fs.exists(packagePath))
    ? (await fs.readJson(packagePath)).version
    : (await fs.exists(
          (packagePath = path.join(dirname, '..', '..', 'package.json'))
        ))
      ? (await fs.readJson(packagePath)).version
      : '0.0.0'

  return version
}

;(async () => {
  const args = process.argv.slice(2)

  await prepareRuntime()

  await fs.ensureDir(zxelDir)
  const db = await prepareDatabase()

  if (db) {
    db.table('history', { code: 'text' })
  }

  /**
   * Entry file to import before starting the shell
   */
  for (const file of await glob(path.join(zxelDir, 'index.{ts,js}'))) {
    await import(file)
  }

  if (args.length) {
    // Concat and evaluate
    console.log(inspect(await runCode(args.slice(1).join(' '))))
    return
  }

  const version = await getVersion()

  function pushHistory(code) {
    if (!(db && db.tables.history)) return
    db.tables.history.set({ code })

    // TODO: Limit max items
  }

  const history =
    db && db.tables.history
      ? (await db.tables.history.get()).map((item) => item.code)
      : []

  await startTerminal({ version, history, pushHistory })
})().catch(console.error)
