export const dataType = {
  text: '',
  integer: 0,
  float: 3.14,
  // bigint: BigInt(0),
  boolean: false,
  blob: new Uint8Array(),
  // Uint8Array: new Uint8Array(),
  // Buffer: globalThis.Buffer?.from(''),
  auto: 1,
}

export type Schema<T> = {
  parsed: string
  schema: Partial<T>
  definition: SchemaDefinition
}

export type SchemaDefinition = {
  [s: string]: string | number | bigint | boolean | Uint8Array | Buffer
}

export function getDataTypeSql(value) {
  // https://www.sqlite.org/datatype3.html
  switch (value) {
    case dataType.text:
    case 'text':
      return 'TEXT'
      break
    case dataType.integer:
    case 'integer':
      return 'INTEGER'
      break
    // case dataType.bigint: // BigInt(0):
    //   return 'BIGINT'
    //   break
    case dataType.boolean: // false
    case 'boolean':
      return 'BOOLEAN'
      break
    case dataType.blob: // false
    case 'blob':
      // case dataType.Uint8Array: //new Uint8Array():
      // case dataType.Buffer: // globalThis.Buffer?.from(''):
      return 'BLOB'
      break
    case dataType.auto:
    case 'auto':
      return 'INTEGER PRIMARY KEY AUTOINCREMENT'
      break
    // Date and time
    // TEXT as ISO8601 strings "YYYY-MM-DD HH:MM:SS.SSS"
    default:
      return value
  }
}

export function schema<T extends SchemaDefinition>(
  definition: T | ((type: typeof dataType) => T),
): Schema<T> {
  if (definition instanceof Function) {
    return schema(definition(dataType))
  }

  let parsed = ''

  // All tables have column "id"
  const def = {
    id: dataType.auto,
    ...definition,
  }

  for (const [key, value] of Object.entries(def)) {
    let type = getDataTypeSql(value)
    if (!type) {
      throw Error('error: Unknown datatype in schema.')
    }
    parsed += key + ' ' + type + ', '
  }
  return {
    parsed: parsed.slice(0, -2),
    schema: {} as Partial<T>,
    definition: def,
  }
}
