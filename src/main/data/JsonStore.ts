import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export class JsonStore<T> {
  constructor(private readonly path: string, private readonly fallback: T) {}
  async read(): Promise<T> {
    try { return JSON.parse(await readFile(this.path, 'utf8')) as T } catch { return this.fallback }
  }
  async write(value: T): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(value, null, 2), 'utf8')
  }
}
