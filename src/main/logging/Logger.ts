import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Writes operational events only; callers must never pass credentials, cookies, tokens, or headers. */
export class Logger {
  constructor(private readonly logPath: string) {}
  async info(message: string): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })
    await appendFile(this.logPath, `[${new Date().toISOString()}] ${message}\n`, 'utf8')
  }
  static at(dataDirectory: string): Logger { return new Logger(join(dataDirectory, 'logs', 'booking.log')) }
}
