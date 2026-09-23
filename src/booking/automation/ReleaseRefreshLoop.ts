import type { JSHandle, Page } from 'playwright'
import { BookingError } from '../errors/BookingError'
import { RELEASE_TIMING } from '../../shared/releaseTiming'

export const RELEASE_LOOP_TIMING = RELEASE_TIMING

export interface ReleaseLoopConfig {
  dateSelector: string
  courts: string[]
  time: string
  releaseAtMs: number
  timing?: typeof RELEASE_LOOP_TIMING
}

export interface ReleaseLoopResult {
  court: string
  slotNumber: string
  facilityId: string
  identifiers: { aId: string | null; tsId: string | null; tsiId: string | null }
  clickedAt: number
  refreshes: number
}

interface LoopOutcome {
  outcome: 'pending' | 'clicked' | 'cancelled' | 'invalid' | 'exhausted'
  message?: string
  result?: ReleaseLoopResult
}

interface BrowserLoopState extends LoopOutcome {
  refreshes: number
  // Resolves with a plain copy, so one evaluate reports a click even if the page navigates right after.
  done: Promise<LoopOutcome>
  cancel(): void
}

/**
 * Runs the whole refresh-until-open-then-Book loop inside Chromium, so no
 * Electron/Playwright round trip sits between seeing the Book button and clicking it.
 */
export class ReleaseRefreshLoop {
  private constructor(private readonly state: JSHandle<BrowserLoopState>) {}

  static async start(page: Page, config: ReleaseLoopConfig): Promise<ReleaseRefreshLoop> {
    if (!Number.isFinite(config.releaseAtMs) || !config.courts.length) throw new BookingError('VALIDATION_ERROR', 'Invalid release loop configuration')
    const state = await page.evaluateHandle(({ dateSelector, courts, time, releaseAtMs, timing }) => {
      let timer: number | undefined
      let finish: (outcome: LoopOutcome) => void = () => undefined
      const state: BrowserLoopState = {
        outcome: 'pending', refreshes: 0,
        done: new Promise<LoopOutcome>(resolve => { finish = resolve }),
        cancel() { if (timer !== undefined) clearTimeout(timer); settle('cancelled') }
      }
      function settle(outcome: BrowserLoopState['outcome'], message?: string): void {
        if (state.outcome !== 'pending') return
        state.outcome = outcome
        state.message = message
        finish({ outcome, message, result: state.result })
      }
      const sleep = (ms: number): Promise<void> => new Promise(resolve => { timer = window.setTimeout(resolve, Math.max(0, ms)) })
      async function sleepUntil(atMs: number): Promise<void> {
        // Short hops so a wall-clock correction is picked up; 1 ms steps at the end.
        for (let remaining = atMs - Date.now(); remaining > 0 && state.outcome === 'pending'; remaining = atMs - Date.now()) {
          await sleep(Math.min(remaining > 20 ? remaining - 10 : 1, 1_000))
        }
      }
      const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim()
      function courtFromText(text: string): string | undefined {
        const match = /Court\s*0?([123])\s*-?\s*AC\s*-?\s*Badminton/i.exec(text)
        return match ? `Court 0${match[1]}-AC-Badminton` : undefined
      }
      // Mirrors uOfTTimeMatches in UofTBookingProvider; page functions cannot import.
      function timeMatches(label: string): boolean {
        const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::\d{2})?\s*(AM|PM)$/i.exec(label.trim())
        if (!match) return false
        const hour = Number(match[1])
        let period = (match[3] ?? match[5]).toUpperCase()
        if (!match[3] && hour % 12 > Number(match[4]) % 12) period = period === 'AM' ? 'PM' : 'AM'
        const startHour = hour % 12 + (period === 'PM' ? 12 : 0)
        return `${String(startHour).padStart(2, '0')}:${match[2] ?? '00'}` === time
      }
      const visibleRows = (): Element[] => Array.from(document.querySelectorAll('.booking-slot-item')).filter(row => row.checkVisibility())
      function courtTab(name: string): HTMLButtonElement | undefined {
        const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).filter(tab => clean(tab.textContent) === name)
        const tab = tabs[0]
        if (tabs.length !== 1 || !tab.checkVisibility() || tab.disabled || tab.getAttribute('aria-disabled') === 'true') return undefined
        return tab
      }
      // Click the court tab and resolve once the site has swapped in fresh rows.
      function refresh(tab: HTMLButtonElement): Promise<boolean> {
        const previous = visibleRows()[0] ?? null
        return new Promise(resolve => {
          const check = (): void => {
            if (state.outcome !== 'pending') return done(false)
            const replaced = !previous || !previous.isConnected || !previous.checkVisibility()
            const fresh = visibleRows()[0]
            if (replaced && fresh && fresh !== previous) done(true)
          }
          // Observer callbacks and the timeout only run after this synchronous setup.
          const done = (ok: boolean): void => { observer.disconnect(); clearTimeout(timeout); resolve(ok) }
          const observer = new MutationObserver(check)
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class'] })
          const timeout = window.setTimeout(() => done(false), timing.refreshTimeoutMs)
          state.refreshes += 1
          tab.click()
        })
      }
      // Live U of T rows: open = "Book Now"; not open = "Opens at 8 PM", or a disabled
      // "Unavailable" that still says "1 spot available"; taken = "Unavailable" + "No spots
      // available"; your own reservation = "Booked" in .booking-slot-reserved-item.
      type Target = { state: 'available'; button: HTMLButtonElement; row: Element } | { state: 'taken' | 'not-open'; row?: Element }
      function findTarget(court: string): Target {
        for (const row of visibleRows()) {
          if (!timeMatches(clean(row.querySelector('strong')?.textContent))) continue
          const button = Array.from(row.querySelectorAll<HTMLButtonElement>('button:not([disabled]):not(.disabled)'))
            .find(node => /^\s*book(?:\s+now)?\s*$/i.test(node.textContent ?? '') && node.checkVisibility() &&
              node.getAttribute('aria-disabled') !== 'true' && courtFromText(node.getAttribute('aria-label') ?? '') === court)
          if (button) return { state: 'available', button, row }
          // Anything unrecognised counts as not open, so the loop keeps refreshing rather than giving up.
          const text = clean(row.textContent)
          const yours = /booked/i.test(clean(row.querySelector('.booking-slot-reserved-item')?.textContent))
          const spotsLeft = Number(/(\d+)\s+spots?\s+available/i.exec(text)?.[1] ?? 0)
          const taken = yours || (!/opens at/i.test(text) && spotsLeft === 0 && /no spots available|unavailable|booked/i.test(text))
          return { state: taken ? 'taken' : 'not-open', row }
        }
        return { state: 'not-open' }
      }
      async function run(): Promise<void> {
        await sleepUntil(releaseAtMs - timing.startBeforeReleaseMs)
        let courtIndex = 0
        let lastClickAt = 0
        while (state.outcome === 'pending') {
          if (lastClickAt) await sleep(lastClickAt + timing.minIntervalMs + Math.random() * (timing.maxIntervalMs - timing.minIntervalMs) - Date.now())
          if (state.outcome !== 'pending') return
          if (Date.now() >= releaseAtMs + timing.stopAfterReleaseMs) return settle('exhausted', `The ${time} slot did not open on any preferred court within ${timing.stopAfterReleaseMs / 1000} s of release.`)
          const date = document.querySelector(dateSelector)
          if (!date?.checkVisibility() || date.getAttribute('aria-current') !== 'date') return settle('invalid', 'The prepared booking date is no longer selected.')
          const court = courts[courtIndex]
          const tab = courtTab(court)
          if (!tab) return settle('invalid', `Court tab ${court} is not available.`)
          lastClickAt = Date.now()
          const refreshed = await refresh(tab)
          if (state.outcome !== 'pending') return
          if (refreshed) {
            const target = findTarget(court)
            if (target.state === 'available') {
              const button = target.button
              state.result = {
                court, slotNumber: target.row.getAttribute('data-slot-number') ?? '',
                facilityId: (tab.getAttribute('id') ?? '').replace(/^tab_/, ''),
                identifiers: { aId: button.getAttribute('data-apt-id'), tsId: button.getAttribute('data-timeslot-id'), tsiId: button.getAttribute('data-timeslotinstance-id') },
                clickedAt: Date.now(), refreshes: state.refreshes
              }
              button.click()
              return settle('clicked')
            }
            // Someone else has it: this court failed, so try the next one in priority order.
            if (target.state === 'taken') {
              if (courtIndex + 1 >= courts.length) return settle('exhausted', `The ${time} slot is unavailable on every preferred court.`)
              courtIndex += 1
              continue
            }
            // Not open yet: click the court again after the next short random gap.
          }
        }
      }
      run().catch((error: unknown) => settle('invalid', error instanceof Error ? error.message : String(error)))
      return state
    }, { ...config, timing: config.timing ?? RELEASE_LOOP_TIMING })
    return new ReleaseRefreshLoop(state)
  }

  /** Resolves when the loop clicked Book; throws if it stopped without clicking. */
  async result(): Promise<ReleaseLoopResult> {
    let done: LoopOutcome
    try { done = await this.state.evaluate(state => state.done) } catch {
      throw new BookingError('BOOKING_CONFIRMATION_FAILED', 'The booking page closed or navigated during the release loop. Check the booking browser for a reservation.')
    }
    const { outcome, message, result } = done
    if (outcome === 'clicked' && result) return result
    if (outcome === 'cancelled') throw new BookingError('BOOKING_CANCELLED')
    if (outcome === 'exhausted') throw new BookingError('NO_AVAILABLE_COURTS', message)
    throw new BookingError('PAGE_STRUCTURE_CHANGED', message)
  }

  async dispose(): Promise<void> {
    await this.state.evaluate(state => state.cancel()).catch(() => undefined)
    await this.state.dispose().catch(() => undefined)
  }
}
