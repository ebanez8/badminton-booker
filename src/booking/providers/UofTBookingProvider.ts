import type { BookingRequest, BookingResult, CourtAvailability } from '../../shared/types'
import { BookingError } from '../errors/BookingError'
import { BrowserManager } from '../automation/BrowserManager'
import { ScheduledCourtClick } from '../automation/ScheduledCourtClick'
import type { BookingProvider } from './BookingProvider'
import type { Locator, Page, Response } from 'playwright'
import { DateTime } from 'luxon'

export function uOfTDateButtonSelector(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match || !DateTime.fromISO(date).isValid) throw new BookingError('VALIDATION_ERROR', 'Invalid booking date')
  const [, year, month, day] = match
  return `button.single-date-select-button[data-year="${Number(year)}"][data-month="${Number(month)}"][data-day="${Number(day)}"]`
}

export function uOfTTimeMatches(label: string, time: string): boolean {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::\d{2})?\s*(AM|PM)$/i.exec(label.trim())
  if (!match) return false
  const hour = Number(match[1])
  let period = (match[3] ?? match[5]).toUpperCase()
  // When only the end has AM/PM, account for a slot crossing noon/midnight.
  if (!match[3] && hour % 12 > Number(match[4]) % 12) period = period === 'AM' ? 'PM' : 'AM'
  const startHour = hour % 12 + (period === 'PM' ? 12 : 0)
  return `${String(startHour).padStart(2, '0')}:${match[2] ?? '00'}` === time
}

export class UofTBookingProvider implements BookingProvider {
  private pageReady = false
  private courtNames: string[] = []
  private scheduledClick?: { task: ScheduledCourtClick; requestKey: string; court: string }
  private submittedCourtId?: string
  private submissionOutcome?: 'confirmed' | 'captcha' | 'rejected'
  private submissionResponse?: Promise<'confirmed' | 'captcha' | 'rejected'>
  private responseListener?: (response: Response) => void
  constructor(private readonly browser: BrowserManager, private readonly bookingUrl: string) {}

  async initialize(): Promise<void> { await this.browser.initialize() }

  async isAuthenticated(): Promise<boolean> {
    const page = await this.browser.getPage()
    await this.navigate(page)
    // Fusion renders the schedule after DOMContentLoaded. A one-shot visibility check here
    // produced a false login-required state for already authenticated profiles.
    if (this.isLoginPage(page)) return false
    await this.waitForDatePicker(page)
    return true
  }

  async requestAuthentication(): Promise<void> {
    const page = await this.browser.show()
    // Keep an in-progress sign-in/MFA page intact.
    if (!this.isLoginPage(page)) await this.navigate(page)
  }

  async prepare(request: BookingRequest, releaseAtMs?: number): Promise<void> {
    await this.scheduledClick?.task.dispose()
    this.scheduledClick = undefined
    // A live submission can require CAPTCHA; keep its browser accessible.
    const page = await this.browser.show()
    this.pageReady = false
    this.submittedCourtId = undefined
    this.submissionOutcome = undefined
    this.submissionResponse = undefined
    if (this.responseListener) page.off('response', this.responseListener)
    await this.navigate(page)
    this.requireSession(page)
    await this.waitForDatePicker(page)
    this.courtNames = await this.readCourtNames(page)
    // The requested date can enter the two-day picker only at release (midnight).
    // Warm up the session now; selecting the exact date is mandatory at release.
    const dateButton = page.locator(`${uOfTDateButtonSelector(request.date)}.single-date-select-one-click:visible`)
    if (await dateButton.count()) {
      await this.selectDate(page, request.date)
      if (request.courtPreferences[0]) await this.selectCourt(page, request.courtPreferences[0])
      const court = request.courtPreferences[0] ?? (request.allowAnyCourt ? this.courtNames[0] : undefined)
      if (court && releaseAtMs !== undefined && releaseAtMs > Date.now()) {
        const task = await ScheduledCourtClick.create(page, `${uOfTDateButtonSelector(request.date)}.single-date-select-one-click`, court, releaseAtMs)
        this.scheduledClick = { task, court, requestKey: JSON.stringify(request) }
      }
    }
    this.pageReady = true
  }

  async getAvailability(request: BookingRequest): Promise<CourtAvailability[]> {
    try { return await this.checkAvailability(request) } catch (error) {
      // Nothing is submitted during availability. A stalled slot refresh may
      // therefore be retried safely by the engine's bounded retry policy.
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new BookingError('NETWORK_ERROR', 'The court schedule refresh timed out before any reservation was submitted.')
      }
      throw error
    }
  }

  private async checkAvailability(request: BookingRequest): Promise<CourtAvailability[]> {
    this.requirePreparedPage()
    const page = await this.browser.getPage()
    this.requireSession(page)
    const scheduled = this.scheduledClick
    let refreshedCourt: string | undefined
    if (scheduled) {
      try {
        if (scheduled.requestKey === JSON.stringify(request)) {
          await scheduled.task.wait()
          refreshedCourt = scheduled.court
        }
      } finally { await scheduled.task.dispose(); if (this.scheduledClick === scheduled) this.scheduledClick = undefined }
    }
    // Preparation selects the date. On the normal release path the first
    // interaction is the preferred court click, which refreshes its slots.
    const selectedDate = page.locator(`${uOfTDateButtonSelector(request.date)}.single-date-select-one-click[aria-current="date"]:visible`)
    if (!(await selectedDate.count())) {
      // A date entering the picker at midnight still needs to be selected.
      if (!(await page.locator(`${uOfTDateButtonSelector(request.date)}.single-date-select-one-click:visible`).count())) {
        await this.navigate(page)
        this.requireSession(page)
      }
      await this.selectDate(page, request.date)
      this.courtNames = await this.readCourtNames(page)
    }
    const order = [...new Set([...request.courtPreferences, ...(request.allowAnyCourt ? this.courtNames : [])])]
    for (const name of order) {
      const panel = await this.selectCourt(page, name, name === refreshedCourt ? undefined : request.date)
      // Read the schedule in one browser round trip, rather than awaiting a
      // separate protocol call for every earlier time slot on the page.
      const rows = await panel.locator('.booking-slot-item').evaluateAll(nodes => nodes.map(row => {
        const button = Array.from(row.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not(.disabled)'))
          .find(node => /^\s*book(?:\s+now)?\s*$/i.test(node.textContent ?? '') && node.checkVisibility() && !node.matches(':disabled') && node.getAttribute('aria-disabled') !== 'true')
        return { time: row.querySelector('strong')?.textContent ?? '', court: button?.getAttribute('aria-label') ?? '', slotNumber: row.getAttribute('data-slot-number') }
      }))
      for (const row of rows) {
        const court = this.courtFromText(row.court)
        if (court === name && row.slotNumber && uOfTTimeMatches(row.time, request.time)) {
          return [{ id: `${court}|${row.slotNumber}`, name: court, available: true }]
        }
      }
    }
    return []
  }

  async reserve(request: BookingRequest, court: CourtAvailability): Promise<BookingResult> {
    this.requirePreparedPage()
    const page = await this.browser.getPage()
    this.requireSession(page)
    const selectedDate = page.locator(`${uOfTDateButtonSelector(request.date)}[aria-current="date"]`)
    if (!(await selectedDate.isVisible())) throw await this.pageError(page, 'The requested date is no longer selected.')
    const [courtName, slotNumber] = court.id.split('|')
    const panel = await this.selectCourt(page, courtName)
    const row = panel.locator(`.booking-slot-item[data-slot-number="${slotNumber}"]`)
    const button = row.locator(`button[aria-label*="${courtName}"]:not([disabled]):not(.disabled)`).filter({ hasText: /^\s*book(?:\s+now)?\s*$/i })
    if (!(await button.isVisible().catch(() => false))) throw new BookingError('COURT_UNAVAILABLE', `Book control for ${court.name} is no longer available.`)
    if (!uOfTTimeMatches(await row.locator('strong').first().innerText(), request.time)) throw await this.pageError(page, 'The requested slot time changed.')
    if (await row.getByText(/^\s*booked\s*$/i).isVisible().catch(() => false)) throw new BookingError('COURT_UNAVAILABLE', 'This slot was already marked booked before submission.')
    this.submittedCourtId = court.id
    const facilityId = (await page.getByRole('tab', { name: courtName, exact: true }).getAttribute('id'))?.replace(/^tab_/, '')
    const identifiers = await button.evaluate(node => ({ aId: node.getAttribute('data-apt-id'), tsId: node.getAttribute('data-timeslot-id'), tsiId: node.getAttribute('data-timeslotinstance-id') }))
    this.submissionResponse = new Promise(resolve => {
      this.responseListener = (response) => {
        const url = new URL(response.url())
        if (url.origin !== new URL(this.bookingUrl).origin || url.pathname !== '/booking/reserve' || response.request().method() !== 'POST') return
        const data = new URLSearchParams(response.request().postData() ?? '')
        const [year, month, day] = request.date.split('-').map(Number)
        if (data.get('fId') !== facilityId || Number(data.get('y')) !== year || Number(data.get('m')) !== month || Number(data.get('d')) !== day ||
            !Object.entries(identifiers).some(([, value]) => value !== null) ||
            !Object.entries(identifiers).every(([key, value]) => value === null || data.get(key) === value)) return
        void response.json().then((result: { Success?: boolean; ErrorCode?: number }) => {
          this.submissionOutcome = result.Success === true ? 'confirmed' : result.ErrorCode === 100 ? 'captcha' : 'rejected'
          resolve(this.submissionOutcome)
        }).catch(() => undefined)
      }
      page.on('response', this.responseListener)
    })
    try { await button.click() } catch {
      throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'The Book click did not finish cleanly. Inspect the browser before trying another booking.')
    }
    return this.confirmReservation(request, court)
  }

  async confirmReservation(request: BookingRequest, court: CourtAvailability): Promise<BookingResult> {
    try { return await this.verifyReservation(request, court) } catch (error) {
      if (error instanceof BookingError && ['CAPTCHA_REQUIRED', 'BOOKING_CONFIRMATION_FAILED'].includes(error.code)) throw error
      throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'The reservation page could not be verified. Check the booking browser before starting another booking.')
    }
  }

  private async verifyReservation(request: BookingRequest, court: CourtAvailability): Promise<BookingResult> {
    if (this.submittedCourtId !== court.id) throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'No matching reservation was submitted in this session.')
    const page = await this.browser.getPage()
    const [courtName, slotNumber] = court.id.split('|')
    const panel = await this.courtPanel(page, courtName)
    const row = panel.locator(`.booking-slot-item[data-slot-number="${slotNumber}"]`)
    // Confirmation must belong to the submitted row, never another court's Booked text.
    try {
      const booked = row.getByText(/^\s*booked\s*$/i)
      const outcome = await booked.isVisible() ? 'confirmed' : this.submissionOutcome ?? await Promise.race([
        this.submissionResponse ?? new Promise<never>(() => {}),
        booked.waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'confirmed' as const)
      ])
      if (outcome === 'captcha') throw new BookingError('CAPTCHA_REQUIRED')
      if (outcome === 'rejected') throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'U of T declined the reservation. Review the booking browser.')
    } catch (error) {
      if (error instanceof BookingError) throw error
      if (await page.getByText(/captcha|verify you are human/i).first().isVisible().catch(() => false)) {
        throw new BookingError('CAPTCHA_REQUIRED', 'Complete verification in the booking browser, then recheck the reservation.')
      }
      throw new BookingError('BOOKING_CONFIRMATION_FAILED', `No confirmation for ${court.name} at ${request.date} ${request.time}. Check the booking browser.`)
    }
    if (!(await page.locator(`${uOfTDateButtonSelector(request.date)}[aria-current="date"]`).isVisible()) ||
        !uOfTTimeMatches(await row.locator('strong').first().innerText(), request.time)) {
      throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'The displayed date or time no longer matches the submitted reservation.')
    }
    return { success: true, court: court.name, date: request.date, time: request.time, message: 'U of T confirmed the selected booking.' }
  }

  async close(): Promise<void> {
    await this.scheduledClick?.task.dispose()
    this.scheduledClick = undefined
    await this.browser.close()
  }
  private requirePreparedPage(): void { if (!this.pageReady) throw new BookingError('UNKNOWN_ERROR', 'Booking page was not prepared') }

  private async selectDate(page: Page, date: string): Promise<void> {
    await this.waitForDatePicker(page)
    const dateButton = page.locator(`${uOfTDateButtonSelector(date)}.single-date-select-one-click:visible`)
    if (!(await dateButton.count())) {
      throw new BookingError('BOOKING_NOT_OPEN', `Date ${date} is not available in the U of T two-day date picker.`)
    }
    const dateChanged = await dateButton.getAttribute('aria-current') !== 'date'
    const oldRow = dateChanged ? (await page.locator('.booking-slot-item:visible').first().elementHandles())[0] : undefined
    if (dateChanged) await dateButton.click()
    try {
      await dateButton.waitFor({ state: 'visible', timeout: 5_000 })
      await page.locator(`${uOfTDateButtonSelector(date)}[aria-current="date"]`).waitFor({ state: 'visible', timeout: 5_000 })
      // aria-current changes before the AJAX schedule; wait for the old rows to leave.
      if (oldRow) await oldRow.waitForElementState('hidden', { timeout: 15_000 })
      await page.locator('.booking-slot-item:visible').first().waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      throw await this.pageError(page, `Date ${date} did not become the selected booking date.`)
    }
  }

  private async courtPanel(page: Page, name: string): Promise<Locator> {
    const button = page.getByRole('tab', { name, exact: true })
    if (await button.count() !== 1) throw await this.pageError(page, `Court selector for ${name} was not found.`)
    const id = await button.getAttribute('id')
    if (!id || !/^[\w-]+$/.test(id)) throw await this.pageError(page, `Court ${name} has no panel identifier.`)
    // Fusion's initial panel has aria-labelledby, but its AJAX replacement
    // does not. An unlabelled panel belongs to the explicitly selected tab.
    const selected = await button.getAttribute('aria-selected') === 'true'
    return page.locator(`[role="tabpanel"][aria-labelledby="${id}"]${selected ? ', [role="tabpanel"]:not([aria-labelledby])' : ''}`)
  }

  private async selectCourt(page: Page, name: string, refreshDate?: string): Promise<Locator> {
    if (!/^Court 0[123]-AC-Badminton$/.test(name)) throw new BookingError('VALIDATION_ERROR', `Unknown court: ${name}`)
    const button = page.getByRole('tab', { name, exact: true })
    if (refreshDate) {
      // Dispatch the site's own click handler in one browser round trip, with
      // date/visibility/enabled checks in the same task. Do not add a date click
      // or Playwright's mouse stability waits to the release-critical path.
      const oldRow = await button.evaluateHandle((node, dateSelector) => {
        const date = document.querySelector(dateSelector)
        if (!date || !date.checkVisibility() || date.getAttribute('aria-current') !== 'date') throw new Error('The prepared booking date changed before the court click.')
        if (!(node instanceof HTMLButtonElement) || !node.checkVisibility() || node.disabled || node.getAttribute('aria-disabled') === 'true') throw new Error('The prepared court tab is not available.')
        const previous = Array.from(document.querySelectorAll('.booking-slot-item')).find(row => row.checkVisibility())
        node.click()
        return previous ?? null
      }, `${uOfTDateButtonSelector(refreshDate)}.single-date-select-one-click`)
      try {
        // The selected tab can update before its slots do. Never consume the
        // pre-release rows merely because the tab is already selected.
        await page.waitForFunction(row => !row || !row.isConnected, oldRow, { polling: 10, timeout: 15_000 })
      } finally { await oldRow.dispose() }
      await page.getByRole('tab', { name, exact: true, selected: true }).waitFor({ state: 'visible', timeout: 10_000 })
      const panel = await this.courtPanel(page, name)
      await panel.locator('.booking-slot-item:visible').first().waitFor({ state: 'visible', timeout: 15_000 })
      return panel
    }
    let panel = await this.courtPanel(page, name)
    if (!(await panel.isVisible())) {
      const oldRow = (await page.locator('.booking-slot-item:visible').first().elementHandles())[0]
      await button.click()
      // Selection changes before the shared panel's old schedule is replaced.
      if (oldRow) await oldRow.waitForElementState('hidden', { timeout: 15_000 })
      if (await button.getAttribute('aria-selected') !== null) {
        await page.getByRole('tab', { name, exact: true, selected: true }).waitFor({ state: 'visible', timeout: 10_000 })
      }
      panel = await this.courtPanel(page, name)
    }
    try {
      await panel.waitFor({ state: 'visible', timeout: 10_000 })
      await panel.locator('.booking-slot-item').first().waitFor({ state: 'visible', timeout: 15_000 })
    } catch { throw await this.pageError(page, `The schedule for ${name} did not finish loading.`) }
    return panel
  }

  private isLoginPage(page: Page): boolean { return /\/home\/signin|\/login|weblogin/i.test(page.url()) }

  private requireSession(page: Page): void {
    if (this.isLoginPage(page)) throw new BookingError('SESSION_EXPIRED')
  }

  private async navigate(page: Page): Promise<void> {
    try {
      const response = await page.goto(this.bookingUrl, { waitUntil: 'domcontentloaded' })
      if (response && response.status() >= 400) throw new Error(`HTTP ${response.status()}`)
    } catch (error) {
      throw new BookingError('NETWORK_ERROR', `Could not load the booking page: ${error instanceof Error ? error.message.split('\n')[0] : 'network error'}`)
    }
  }

  private async waitForDatePicker(page: Page): Promise<void> {
    this.requireSession(page)
    try { await page.locator('button.single-date-select-one-click:visible').first().waitFor({ state: 'visible', timeout: 15_000 }) } catch {
      this.requireSession(page)
      throw await this.pageError(page, 'The booking date picker did not finish loading.')
    }
  }

  private courtFromText(text: string): string | undefined {
    const match = /Court\s*0?([123])\s*-?\s*AC\s*-?\s*Badminton/i.exec(text)
    return match ? `Court 0${match[1]}-AC-Badminton` : undefined
  }

  private async readCourtNames(page: Page): Promise<string[]> {
    return (await page.getByRole('tab').allTextContents()).map(text => this.courtFromText(text.trim())).filter((name): name is string => !!name)
  }

  private async pageError(page: Page, detail: string): Promise<BookingError> {
    const url = new URL(page.url())
    return new BookingError('PAGE_STRUCTURE_CHANGED', `${detail} Page: ${url.origin}${url.pathname}`)
  }
}
