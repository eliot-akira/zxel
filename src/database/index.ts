/**
 * SQLite database
 * https://bun.sh/docs/api/sqlite
 */

import { join } from 'node:path'
import { runtimeValue, currentRuntime, isDeno } from '../runtime.ts'
import Table from './table.ts'
import { schema } from './schema.ts'
import type { Database as SQLiteDatabase } from 'bun:sqlite'

let SQLite: SQLiteDatabase

export async function createSQLite(): Promise<SQLiteDatabase> {
  if (!SQLite) {
    SQLite = await import(
      runtimeValue({
        bun: 'bun:sqlite',
        deno: 'https://deno.land/x/sqlite3@0.9.1/mod.ts',
        node: 'better-sqlite3',
      }) as string
    )
    // @ts-ignore
    SQLite = SQLite.Database ?? SQLite.default
  }

  return SQLite
}

export async function database(config?: string) {
  await createSQLite()
  return new Database(config)
}

export class Database {
  private readonly db: typeof SQLite

  public tables: {
    [name: string]: Table<any>
  } = {}

  constructor(config?: string | Buffer | Uint8Array) {
    if (config instanceof Buffer || config instanceof Uint8Array) {
      // Serialized
      if (isDeno) throw Error('Serialized type is not supported!')
      this.db = new SQLite(config)
    } else if (typeof config === 'string') {
      // File
      this.db = new SQLite(
        join(
          config.startsWith('/')
            ? ''
            : runtimeValue({
                bun: globalThis.process?.cwd(),
                deno: globalThis.Deno?.cwd(),
                node: globalThis.process?.cwd(),
              }),
          config,
        ),
        { create: true },
      )
    } else {
      // Memory
      this.db = new SQLite(':memory:')
    }

    this.pragma('journal_mode').set('WAL')

    // for (const table of this.tables() ?? []) {
    //   if (table.name!=='sqlite_sequence') {
    //     Object.defineProperty(this, table.name, {
    //       get() {
    //         return this.table(table.name)
    //       }
    //     })
    //   }
    // }

    for (const table of this.tableInfos() ?? []) {
      if (table.name.startsWith('sqlite_')) continue
      this.table(table.name)
    }
  }

  rename(name, newName) {
    this.db.exec(`ALTER TABLE ${name} RENAME TO ${newName}`)
  }

  tableInfo(name) {
    const results = this.run(
      `select * from sqlite_schema where (type = 'table' AND name = '${name}')`,
    )
    return results ? results[0] : null
  }
  tableInfos() {
    return this.run(`select * from sqlite_schema where type = 'table'`)
  }

  table<T extends { [s: string]: any }>(name: string, schemaDefinition?: T) {
    return (this.tables[name] = new Table<T>(
      name,
      schema(schemaDefinition || ((t) => ({ id: t.auto }))),
      this.db,
    ))
  }

  drop(name: string) {
    delete this.tables[name]
    this.db.exec(`DROP TABLE IF EXISTS ${name}`)
  }

  pragma(name: string) {
    return {
      get: () => this.db.prepare(`PRAGMA ${name}`).get()[name],
      set: (value: string) => this.db.exec(`PRAGMA ${name} = ${value}`) as void,
    }
  }

  prepare(query: string) {
    return this.db.prepare(query)
  }

  run(query: string, ...args: any[]) {
    try {
      const res = this.db.prepare(query).all(...args)
      return !res ? null : res
    } catch (error: any) {
      if (
        error.message ===
        'This statement does not return data. Use run() instead'
      ) {
        this.db.exec(query)
        return null
      } else throw error
    }
  }
  exec(query: string) {
    this.db.exec(query)
  }
  serialize() {
    if (isDeno) throw Error('serialize() is not supported!')
    return this.db.serialize() as Buffer | Uint8Array
  }
  clone() {
    if (isDeno) throw Error('clone() is not supported!')
    return new Database(this.serialize())
  }
  async backup(filename: string, location = process.cwd()) {
    const path = location + filename + '.sqlite'
    switch (currentRuntime) {
      case 'deno':
        throw Error('backup() is not supported!')
      case 'bun':
        await Bun.write(path, this.serialize())
        break
      case 'node':
        // @ts-ignore
        await this.db.backup(path)
        break
    }
  }
  close() {
    this.db.close()
  }
}

export function getSqliteVersion() {
  const db = new SQLite(':memory:')
  const ver = db.prepare('SELECT sqlite_version() AS version').get().version
  db.close()
  return ver
}

export { schema } from './schema.js'
