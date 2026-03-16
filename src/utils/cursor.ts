import type { Cursor } from '../types.js'

export function encodeCursor(type: string, id: string): string {
  return Buffer.from(`${type}|${id}`).toString('base64')
}

export function decodeCursor(cursorString: string | null | undefined): Cursor | null {
  if (!cursorString) {
    return null
  }

  const decoded = Buffer.from(cursorString, 'base64').toString('utf-8')
  const parts = decoded.split('|')

  if (parts.length !== 2) {
    return null
  }

  return { type: parts[0], id: parts[1] }
}
