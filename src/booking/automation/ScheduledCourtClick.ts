import type { JSHandle, Page } from 'playwright'
import { BookingError } from '../errors/BookingError'

interface BrowserClickState {
  outcome: 'pending' | 'clicked' | 'cancelled' | 'invalid'
  message?: string
  clickedAt?: number
  previousRow: Element | null
  cancel(): void
}

/** Schedules only the court refresh. Reservation submission stays in the engine. */
export class ScheduledCourtClick {
  private constructor(private readonly page: Page, private readonly state: JSHandle<BrowserClickState>) {}

  static async create(page: Page, dateSelector: string, courtName: string, atMs: number): Promise<ScheduledCourtClick> {
    if (!Number.isFinite(atMs)) throw new BookingError('VALIDATION_ERROR', 'Invalid court-click deadline')
    const state = await page.evaluateHandle(({ dateSelector, courtName, atMs }) => {
      let timer: number | undefined
      const state: BrowserClickState = {
        outcome: 'pending', previousRow: null,
        cancel() { if (timer !== undefined) clearTimeout(timer); if (state.outcome === 'pending') state.outcome = 'cancelled' }
      }
      const tick = (): void => {
        if (state.outcome !== 'pending') return
        const remaining = atMs - Date.now()
        if (remaining > 0) {
          // Recheck clock corrections without busy-waiting. This timer lives
          // in Chromium, independently of the Electron main process.
          timer = window.setTimeout(tick, Math.min(remaining > 20 ? remaining - 10 : 1, 1_000))
          return
        }
        const date = document.querySelector(dateSelector)
        const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]'))
          .filter(tab => tab.textContent?.replace(/\s+/g, ' ').trim() === courtName)
        const tab = tabs[0]
        if (!date?.checkVisibility() || date.getAttribute('aria-current') !== 'date' ||
            tabs.length !== 1 || !tab.checkVisibility() || tab.disabled || tab.getAttribute('aria-disabled') === 'true') {
          state.outcome = 'invalid'
          state.message = 'The prepared date or court changed before release. No court was clicked.'
          return
        }
        state.previousRow = Array.from(document.querySelectorAll('.booking-slot-item')).find(row => row.checkVisibility()) ?? null
        state.clickedAt = Date.now()
        tab.click()
        state.outcome = 'clicked'
      }
      tick()
      return state
    }, { dateSelector, courtName, atMs })
    return new ScheduledCourtClick(page, state)
  }

  async wait(): Promise<number> {
    await this.page.waitForFunction(state => state.outcome !== 'pending', this.state, { polling: 10, timeout: 15_000 })
    const result = await this.state.evaluate(state => ({ outcome: state.outcome, clickedAt: state.clickedAt, message: state.message }))
    if (result.outcome === 'cancelled') throw new BookingError('BOOKING_CANCELLED')
    if (result.outcome !== 'clicked' || result.clickedAt === undefined) throw new BookingError('PAGE_STRUCTURE_CHANGED', result.message)
    const previous = await this.state.getProperty('previousRow')
    try { await this.page.waitForFunction(row => !row || !row.isConnected, previous, { polling: 10, timeout: 15_000 }) }
    finally { await previous.dispose() }
    return result.clickedAt
  }

  async dispose(): Promise<void> {
    // A closed/navigated page already destroyed its timer.
    await this.state.evaluate(state => state.cancel()).catch(() => undefined)
    await this.state.dispose().catch(() => undefined)
  }
}
