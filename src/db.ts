/**
 * Create database for persistent history and any other purpose
 */
import path from 'node:path'
import os from 'node:os'
import { zxelDir, dbPath } from './common'
import { database, schema, createSQLite } from './database'

export async function prepareDatabase() {
  /**
   * Create default database
   */
  try {
    await createSQLite()
  } catch (e) {
    return
  }

  const db = await database(dbPath)

  db.create = function (filePath: string, ...args: any[]) {
    if (typeof filePath === 'string') {
      if (filePath.startsWith('/')) {
        // Absolute path
      } else if (filePath.startsWith('~/')) {
        // Home
        filePath = filePath.replace('~/', os.homedir() + '/')
      } else if (filePath.startsWith('./')) {
        // Current working directory
        filePath = path.join(process.cwd(), filePath)
      } else {
        // By default, relative to ~/.zxel
        filePath = path.join(zxelDir, filePath)
      }
    }
    return database(filePath)
  }

  Object.assign(globalThis, {
    db,
    tables: db.tables,
  })

  return db
}
