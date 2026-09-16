import { chromium, type BrowserContext, type Page } from 'playwright'

export class BrowserManager {
  private context?: BrowserContext
  private page?: Page
  constructor(private readonly profileDirectory: string, private readonly showBrowser: boolean) {}

  async initialize(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page
    this.context = await chromium.launchPersistentContext(this.profileDirectory, { headless: !this.showBrowser })
    this.page = this.context.pages()[0] ?? await this.context.newPage()
    return this.page
  }

  async getPage(): Promise<Page> { return this.initialize() }

  async close(): Promise<void> {
    await this.context?.close()
    this.context = undefined
    this.page = undefined
  }
}
