import { dataType, getDataTypeSql } from './schema'
import type { Schema } from './schema'

type FilterOptions<T> = {
  condition: string
  pattern: string
  fromKeys: (keyof T)[]
  unique: boolean
  operation: 'Min' | 'Max' | 'Avg' | 'Sum' | 'Count'
  sort: { keyName: keyof T; type: 'asc' | 'desc' }[]
  limit: number
  offset: number
}

export const cleanIdentifier = (s: string) => s.replace(/[^0-9a-z_]/gi, '')

export default class Table<T extends { [s: string]: any }> {
  public readonly name: string
  public readonly db
  public readonly columnMap: {
    [name: string]: {}
  } = {}
  constructor(name: string, schema: Schema<any>, db: any) {
    this.name = name
    this.db = db

    const { parsed, definition = {} } = schema

    if (parsed) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.name}(${parsed})`)
    }

    /**
     * Update table: add/remove columns
     */
    this.columnMap = this.columns().reduce((obj, col) => {
      obj[col.name] = col
      return obj
    }, {})

    for (const colName of Object.keys(definition)) {
      if (!this.columnMap[colName]) {
        this.addColumn(colName, definition[colName])
      }
    }
  }

  addColumn(name, type) {
    const sqlType = getDataTypeSql(type)
    this.db.exec(`ALTER TABLE ${this.name} ADD COLUMN ${name} ${sqlType}`)
  }

  get(): T | null
  get(keyName: Partial<FilterOptions<T>>): T[] | null
  get(keyName: keyof T, keyValue: T[keyof T]): T | null
  get(keyName: keyof T, keyValue: T[keyof T], fetchAll: true): T[]
  get(keyName: keyof T, keyValue: T[keyof T], fetchAll: false): T | null
  get(
    keyName?: keyof T | Partial<FilterOptions<T>>,
    keyValue?: T[keyof T],
    fetchAll = false,
  ) {
    if (typeof keyName !== 'string') {
      return this.select(keyName as Partial<FilterOptions<T>>)
    }
    const res = this.db
      .prepare(`SELECT * FROM ${this.name} WHERE ${keyName as string} = ?`)
      [fetchAll ? 'all' : 'get'](keyValue)
    return !res ? null : res
  }

  has(keyName: keyof T, keyValue: T[keyof T]) {
    return !!this.get(keyName, keyValue)
  }

  set(...data: T[]) {
    this.db.transaction(() => {
      for (const row of data) {
        const [keyName, keyValue] = ['id', row.id] // Object.entries(row)[0]
        const keys = Object.keys(row)
        if (
          // this.has(keyName as keyof T, keyValue)
          keyValue
        ) {
          this.db
            .prepare(
              `UPDATE ${this.name} SET ${keys.map((x) => x + ' = ?').join(', ')} WHERE ${keyName} = ?`,
            )
            .run(...Object.values(row), keyValue)
        } else {
          this.db
            .prepare(
              `INSERT INTO ${this.name} (${keys.join(', ')}) VALUES (${'?, '.repeat(keys.length).slice(0, -2)})`,
            )
            .run(...Object.values(row))
        }
      }
    })()
  }

  transaction(fn) {
    return this.db.transaction(fn)
  }

  deleteAll() {
    return this.delete({})
  }

  delete(
    keyName: keyof T | Partial<FilterOptions<T>>,
    keyValue?: T[keyof T],
  ): any {
    if (!keyName) return
    if (typeof keyName === 'string') {
      return this.db
        .prepare(`DELETE FROM ${this.name} WHERE ${keyName as string} = ?`)
        .run(keyValue)
    }
    return this.filter('Delete', keyName as Partial<FilterOptions<T>>)
  }

  select(options: Partial<FilterOptions<T>> = {}) {
    return this.filter('Select', options)
  }

  filter(action: 'Select' | 'Delete', options: Partial<FilterOptions<T>>) {
    const what =
      (options.unique ? 'DISTINCT ' : '') +
      (options.fromKeys
        ? options.fromKeys?.join(', ')
        : action === 'Delete'
          ? ''
          : '*')

    const sanitizeValues = []
    let query =
      `${action.toUpperCase()} ` +
      (options.operation ? `${options.operation}(${what}) AS result` : what) +
      ` FROM ${this.name}` +
      (options.condition
        ? ` WHERE ${this.parseCondition(options.condition)}`
        : '') +
      (options.pattern ? ` LIKE ${options.pattern}` : '') +
      (options.sort
        ? ` ORDER BY ${options.sort
            ?.map(
              (x) =>
                `${x.keyName as string} ${x.type === 'asc' ? 'ASC' : 'DESC'}`,
            )
            .join(', ')}`
        : '') +
      (options.limit ? ` LIMIT ${options.limit}` : '') +
      (options.offset ? ` OFFSET ${options.offset}` : '')

    const res = this.db.prepare(query).all(...sanitizeValues)
    return options.operation ? res[0].result : res
  }

  columns() {
    return this.db
      .prepare(`pragma table_info(${cleanIdentifier(this.name)})`)
      .all()
  }

  renameColumn(name, newName) {
    return this.db.transaction(() => {
      //   CREATE TABLE temp_table (NewColumnName OldColumnType);
      //   INSERT INTO temp_table SELECT * FROM old_table;
      //   DROP TABLE old_table;
      //   ALTER TABLE temp_table RENAME TO old_table;
    })
  }

  private parseCondition(condition: string) {
    return condition
      .replaceAll(/===|==/g, '=')
      .replaceAll('&&', ' AND ')
      .replaceAll('||', ' OR ')
  }
}
