import type { BookingRequest, BookingResult, CourtAvailability } from '../../shared/types'
import { BookingError } from '../errors/BookingError'
import { BrowserManager } from '../automation/BrowserManager'
import type { BookingProvider } from './BookingProvider'

/** All U of T URL and future selectors live here. Authenticated selectors require live DOM inspection. */
export class UofTBookingProvider implements BookingProvider {
  private pageReady = false
  constructor(private readonly browser: BrowserManager, private readonly bookingUrl: string) {}

  async initialize(): Promise<void> { await this.browser.initialize() }

  async isAuthenticated(): Promise<boolean> {
    // Intentionally unresolved: authenticated account-control evidence must be captured from live DOM.
    // URL-only checks are forbidden because they can report false positives after session expiry.
    return false
  }

  async requestAuthentication(): Promise<void> {
    const page = await this.browser.getPage()
    await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
  }

  async prepare(_request: BookingRequest): Promise<void> {
    const page = await this.browser.getPage()
    await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
    this.pageReady = true
  }

  async getAvailability(_request: BookingRequest): Promise<CourtAvailability[]> {
    this.requirePreparedPage()
    throw new BookingError('PAGE_STRUCTURE_CHANGED', 'U of T authenticated availability selectors require inspected DOM')
  }

  async reserve(_request: BookingRequest, _court: CourtAvailability): Promise<BookingResult> {
    this.requirePreparedPage()
    throw new BookingError('PAGE_STRUCTURE_CHANGED', 'U of T reservation and confirmation selectors require inspected DOM')
  }

  async close(): Promise<void> { await this.browser.close() }
  private requirePreparedPage(): void { if (!this.pageReady) throw new BookingError('UNKNOWN_ERROR', 'Booking page was not prepared') }
}
