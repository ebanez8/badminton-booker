import { chromium, type BrowserContext, type Page } from 'playwright'

export class BrowserManager {
  private context?: BrowserContext
  private page?: Page
  private initializing?: Promise<Page>
  private visible: boolean
  constructor(private readonly profileDirectory: string, showBrowser: boolean) { this.visible = showBrowser }

  async initialize(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    if (this.initializing) return this.initializing
    this.initializing = this.openPage()
    try { return await this.initializing } finally { this.initializing = undefined }
  }

  private async openPage(): Promise<Page> {
    if (!this.context) {
      this.context = await chromium.launchPersistentContext(this.profileDirectory, { headless: !this.visible, args: ['--restore-last-session'] })
      this.context.on('close', () => { this.context = undefined; this.page = undefined })
    }
    this.page = this.context.pages().find((page) => !page.isClosed()) ?? await this.context.newPage()
    return this.page
  }

  async getPage(): Promise<Page> { return this.initialize() }

  async show(): Promise<Page> {
    if (!this.visible) { await this.close(); this.visible = true }
    const page = await this.initialize()
    await page.bringToFront()
    return page
  }

  async close(): Promise<void> {
    await this.initializing?.catch(() => undefined)
    await this.context?.close()
    this.context = undefined
    this.page = undefined
  }
}
