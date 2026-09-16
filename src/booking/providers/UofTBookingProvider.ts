import type { BookingRequest, BookingResult, CourtAvailability } from '../../shared/types'
import { BookingError } from '../errors/BookingError'
import { BrowserManager } from '../automation/BrowserManager'
import type { BookingProvider } from './BookingProvider'
import type { Page } from 'playwright'

export class UofTBookingProvider implements BookingProvider {
  private pageReady = false
  constructor(private readonly browser: BrowserManager, private readonly bookingUrl: string) {}

  async initialize(): Promise<void> { await this.browser.initialize() }

  async isAuthenticated(): Promise<boolean> {
    const page = await this.browser.getPage()
    await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
    // Fusion renders the schedule after DOMContentLoaded. A one-shot visibility check here
    // produced a false login-required state for already authenticated profiles.
    const schedule = page.locator('.booking-slot-item').first()
    try {
      await schedule.waitFor({ state: 'visible', timeout: 15_000 })
      return true
    } catch {
      return false
    }
  }

  async requestAuthentication(): Promise<void> {
    const page = await this.browser.getPage()
    await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
  }

  async prepare(request: BookingRequest): Promise<void> {
    const page = await this.browser.getPage()
    await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
    await this.selectDate(page, request.date)
    this.pageReady = true
  }

  async getAvailability(request: BookingRequest): Promise<CourtAvailability[]> {
    this.requirePreparedPage()
    const page = await this.browser.getPage()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await this.selectDate(page, request.date)
    const rows = page.locator('.booking-slot-item').filter({ has: page.locator('strong', { hasText: this.timePattern(request.time) }) })
    const rowCount = await rows.count()
    if (!rowCount) throw await this.pageError(page, `No schedule row matched ${request.time}.`)
    const available: CourtAvailability[] = []
    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index)
      const button = row.locator('button:not([disabled])').filter({ hasText: /^book$/i })
      if (!(await button.count()) || !(await button.isEnabled())) continue
      const label = await button.getAttribute('aria-label')
      const court = this.courtFromText(label ?? '')
      const slotNumber = await row.getAttribute('data-slot-number')
      if (court && slotNumber) available.push({ id: `${court}|${slotNumber}`, name: court, available: true })
    }
    if (!available.length) throw await this.pageError(page, `No Book control matched ${request.time}.`)
    return available
  }

  async reserve(request: BookingRequest, court: CourtAvailability): Promise<BookingResult> {
    this.requirePreparedPage()
    const page = await this.browser.getPage()
    const [courtName, slotNumber] = court.id.split('|')
    const row = page.locator(`.booking-slot-item[data-slot-number="${slotNumber}"]`)
    const button = row.locator(`button[aria-label*="${courtName}"]:not([disabled])`)
    if (!(await button.isVisible().catch(() => false))) throw await this.pageError(page, `Book control for ${court.name} is no longer available.`)
    await button.click()
    const outcome = await Promise.race([
      page.getByText(/\bbooked\b/i).first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'booked' as const),
      page.getByText(/captcha|verify you are human|recaptcha/i).first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'captcha' as const)
    ]).catch(() => 'unknown' as const)
    if (outcome === 'captcha') throw new BookingError('CAPTCHA_REQUIRED', 'CAPTCHA appeared after clicking Book; complete it in the visible booking browser.')
    if (outcome !== 'booked') throw await this.pageError(page, `Book click for ${court.name} did not produce a booked confirmation.`)
    return { success: true, court: court.name, date: request.date, time: request.time, message: 'U of T confirmed the booking.' }
  }

  async close(): Promise<void> { await this.browser.close() }
  private requirePreparedPage(): void { if (!this.pageReady) throw new BookingError('UNKNOWN_ERROR', 'Booking page was not prepared') }

  private async selectDate(page: Page, date: string): Promise<void> {
    const dateInput = page.locator('input[type="date"]').first()
    if (!(await dateInput.count())) return
    await dateInput.fill(date)
    await dateInput.press('Enter')
    await page.waitForLoadState('domcontentloaded').catch(() => undefined)
  }

  private timePattern(time: string): RegExp {
    const [hourText] = time.split(':')
    const hour = Number(hourText)
    const displayHour = hour % 12 || 12
    const meridiem = hour < 12 ? 'AM' : 'PM'
    return new RegExp(`^${displayHour}(?::00)?\\s*(?:-|–|to)\\s*${displayHour}(?::\\d{2})?\\s*${meridiem}$`, 'i')
  }

  private courtFromText(text: string): string | undefined {
    const match = /Court\s*0?([123])\s*-?\s*AC\s*-?\s*Badminton/i.exec(text)
    return match ? `Court 0${match[1]}-AC-Badminton` : undefined
  }

  private async pageError(page: Page, detail: string): Promise<BookingError> {
    const visibleText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500)
    return new BookingError('PAGE_STRUCTURE_CHANGED', `${detail} URL: ${page.url()}. Visible page text: ${visibleText}`)
  }
}
