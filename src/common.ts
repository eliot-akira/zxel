import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { inspect as _inspect } from 'node:util'

export const inspectOptions = {
  colors: true,
  depth: Infinity,
  maxArrayLength: Infinity,
  maxStringLength: Infinity,
}
export const inspect = (value: any) => _inspect(value, inspectOptions)

export const isDev = process.env.NODE_ENV === 'development'

export const zxelDir = path.join(os.homedir(), '.zxel')
export const dbPath = path.join(zxelDir, 'db.sqlite')

export const debugStream = isDev
  ? fs.createWriteStream(path.join(zxelDir, 'debug.txt'))
  : {
      write() {},
      close() {},
    }

process.on('beforeExit', () => {
  debugStream.close()
})

export const log = (str: string) => (isDev ? debugStream.write(str) : null)
