import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { BrowserManager } from '../automation/BrowserManager'
import { ScheduledCourtClick } from '../automation/ScheduledCourtClick'
import { UofTBookingProvider } from './UofTBookingProvider'
import type { BookingRequest } from '../../shared/types'
import { BookingEngine } from '../BookingEngine'
import { BookingScheduler } from '../BookingScheduler'
import { DateTime } from 'luxon'

const request: BookingRequest = { activity: 'Badminton', date: '2030-09-23', time: '21:10', courtPreferences: ['Court 03-AC-Badminton', 'Court 02-AC-Badminton', 'Court 01-AC-Badminton'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const url = 'http://booking.test/booking/badminton'
type FixtureInteraction = { type: 'date' | 'court'; value: number; at: number }
type FixtureWindow = { interactions: FixtureInteraction[]; courtsAvailable: boolean }

// Reproduces the inspected Fusion DOM: hidden duplicate dates, lazy court panels,
// repeated slot numbers across courts, and date selection preceding schedule refresh.
function fixture(confirm = true, emptyToday = false, sharedPanel = false): string {
  return `<main><div id="app"></div><div>Booked</div></main><script>
    let day = 21, court = 1;
    window.bookClicks = 0;
    window.interactions = [];
    window.courtsAvailable = true;
    function dates() {
      return [21, 23].map(d => '<div hidden><button class="single-date-select-button single-date-select-two-click" data-year="2030" data-month="9" data-day="'+d+'">'+d+'</button></div><button onclick="selectDate('+d+')" class="single-date-select-button single-date-select-one-click" data-year="2030" data-month="9" data-day="'+d+'" '+(d===day?'aria-current="date"':'')+'>'+d+'</button>').join('');
    }
    function slots(n) {
      if (${emptyToday} && day === 21) return '';
      const name = 'Court 0'+n+'-AC-Badminton';
      const available = n > 1 && window.courtsAvailable;
      return '<div class="booking-slot-item" data-slot-number="1"><strong>'+(day===23?'9:10 - 9:55 PM':'7 - 7:55 AM')+'</strong><div class="action">'+(available?'<button onclick="book(this)" aria-label="'+name+' booking">\\n\\tBook Now\\n\\t</button>':'<button class="disabled" aria-label="'+name+' unavailable">Unavailable</button>')+'</div></div>';
    }
    function render() {
      document.getElementById('app').innerHTML = '<div id="dates">'+dates()+'</div><div hidden><button>Court 01-AC-Badminton</button></div>' + [1,2,3].map(n => '<button role="tab" aria-selected="'+(court===n)+'" id="tab_'+n+'" onclick="selectCourt('+n+')">Court 0'+n+'-AC-Badminton</button>').join('') + (${sharedPanel} ? '<div role="tabpanel">'+slots(court)+'</div>' : [1,2,3].map(n => '<div role="tabpanel" aria-labelledby="tab_'+n+'" '+(court===n?'':'hidden')+'>'+(court===n?slots(n):'')+'</div>').join(''));
    }
    function selectDate(d) { window.interactions.push({type:'date',value:d,at:Date.now()}); day=d; document.getElementById('dates').innerHTML=dates(); setTimeout(render, 150); }
    function selectCourt(n) { window.interactions.push({type:'court',value:n,at:Date.now()}); court=n; document.querySelectorAll('[role=tabpanel]').forEach(p => p.hidden=true); setTimeout(render, 100); }
    function book(button) { window.bookClicks++; ${confirm ? "setTimeout(() => button.parentElement.innerHTML='<span>Booked</span>', 100);" : ''} }
    setTimeout(render, 100);
  </script>`
}

describe('U of T browser flow', () => {
  let browser: Browser
  let page: Page
  let provider: UofTBookingProvider
  beforeAll(async () => { browser = await chromium.launch({ headless: true }) }, 20000)
  afterAll(async () => { await browser?.close() })
  beforeEach(async () => {
    page = await browser.newPage()
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture() }))
    class TestBrowser extends BrowserManager {
      override async initialize() { return page }
      override async getPage() { return page }
      override async show() { return page }
      override async close() { await page.close() }
    }
    provider = new UofTBookingProvider(new TestBrowser('', false), url)
  })
  afterEach(async () => { await page.close() })

  it('waits for visible dates and refreshed rows, then books the highest-priority court', async () => {
    expect(await provider.isAuthenticated()).toBe(true)
    await provider.prepare(request)
    const available = await provider.getAvailability(request)
    expect(available).toEqual([{ id: 'Court 03-AC-Badminton|1', name: 'Court 03-AC-Badminton', available: true }])
    const result = await provider.reserve(request, available[0])
    expect(result).toMatchObject({ success: true, court: 'Court 03-AC-Badminton', date: request.date, time: request.time })
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
  }, 20000)

  it('runs the real scheduler and engine through a timed browser submission', async () => {
    const releaseAt = Date.now() + 3000
    const prepared = { ...request, ...(() => {
      const desired = DateTime.fromMillis(releaseAt).setZone('America/Toronto').plus({ hours: 48 })
      return { date: desired.toISODate()!, time: desired.toFormat('HH:mm') }
    })() }
    // Keep the production validation and 48-hour calculation; translate only
    // the local fixture's fixed display date/time at the provider boundary.
    const scheduler = new BookingScheduler()
    const scheduledArm = scheduler.arm.bind(scheduler)
    scheduler.arm = (_at, callbacks) => scheduledArm(releaseAt, callbacks)
    let requestAt = 0
    let confirmed!: () => void
    const finished = new Promise<void>(resolve => { confirmed = resolve })
    await page.route('http://booking.test/booking/reserve', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Success: true }) }))
    page.on('request', outgoing => { if (new URL(outgoing.url()).pathname === '/booking/reserve') requestAt = Date.now() })
    const engine = new BookingEngine({
      initialize: async () => undefined, isAuthenticated: async () => true, requestAuthentication: async () => undefined,
      prepare: async () => {
        await provider.prepare(request, releaseAt)
        expect(Date.now()).toBeLessThan(releaseAt - 100)
        await page.evaluate(() => { (window as unknown as FixtureWindow).interactions = [] })
      }, getAvailability: async () => {
        const courts = await provider.getAvailability(request)
        await page.locator('[role=tabpanel]:visible button').evaluate(node => { node.setAttribute('data-timeslot-id', 'slot3') })
        await page.evaluate(() => {
          const fixtureWindow = window as unknown as { book: () => void }
          fixtureWindow.book = () => { void fetch('/booking/reserve', { method: 'POST', body: new URLSearchParams({ fId: '3', y: '2030', m: '9', d: '23', tsId: 'slot3' }) }) }
        })
        return courts
      },
      reserve: async (_request, court) => provider.reserve(request, court),
      confirmReservation: async (_request, court) => provider.confirmReservation(request, court), close: async () => undefined
    }, scheduler, { maxRetries: 1, retryDelayMs: 250, saveHistory: async () => undefined, logger: { info: async () => undefined } })
    engine.subscribe(state => { if (['confirmed', 'failed', 'confirmation-required'].includes(state.status)) confirmed() })
    try {
      await engine.arm(prepared)
      await finished
      expect(engine.getState().status).toBe('confirmed')
      const dispatchDelay = Date.parse(engine.getState().timing!.releaseStartedAt!) - releaseAt
      expect(dispatchDelay).toBeGreaterThanOrEqual(0)
      expect(dispatchDelay).toBeLessThan(250)
      expect(requestAt).toBeGreaterThanOrEqual(releaseAt)
      expect(requestAt - releaseAt).toBeLessThan(3000)
      const interactions = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
      expect(interactions).toHaveLength(1)
      expect(interactions[0]).toMatchObject({ type: 'court', value: 3 })
      expect(interactions[0].at).toBeGreaterThanOrEqual(releaseAt)
      expect(interactions[0].at - releaseAt).toBeLessThan(250)
      console.log(`Timed browser fixture: release dispatch +${dispatchDelay} ms; court click +${interactions[0].at - releaseAt} ms; reservation request +${requestAt - releaseAt} ms.`)
    } finally { await engine.close() }
  }, 15000)

  it('clicks in Chromium on time while the app process is blocked, then consumes that refresh once', async () => {
    const releaseAt = Date.now() + 2500
    await provider.prepare(request, releaseAt)
    await page.evaluate(() => { (window as unknown as FixtureWindow).interactions = [] })
    await new Promise(resolve => setTimeout(resolve, Math.max(0, releaseAt - Date.now() - 50)))
    // Simulate a stalled Electron main process without burning CPU. Chromium
    // must perform the already-scheduled click while this thread cannot run.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 350)
    expect(Date.now() - releaseAt).toBeGreaterThanOrEqual(250)
    expect((await provider.getAvailability(request))[0].name).toBe('Court 03-AC-Badminton')
    const interactions = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
    expect(interactions).toHaveLength(1)
    expect(interactions[0]).toMatchObject({ type: 'court', value: 3 })
    expect(interactions[0].at - releaseAt).toBeGreaterThanOrEqual(0)
    expect(interactions[0].at - releaseAt).toBeLessThan(100)
    console.log(`Busy app fixture: browser court click +${interactions[0].at - releaseAt} ms while app blocked through +${Date.now() - releaseAt} ms.`)
  }, 10000)

  it('cancels a browser-scheduled click before release', async () => {
    await provider.prepare(request)
    await page.evaluate(() => { (window as unknown as FixtureWindow).interactions = [] })
    const task = await ScheduledCourtClick.create(page, 'button.single-date-select-one-click[data-day="23"]', 'Court 03-AC-Badminton', Date.now() + 250)
    await task.dispose()
    await page.waitForTimeout(350)
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).interactions)).toEqual([])
  }, 10000)

  it('does not click at release if the prepared date was changed', async () => {
    const releaseAt = Date.now() + 1500
    await provider.prepare(request, releaseAt)
    await page.locator('button.single-date-select-one-click[data-day="21"]').click()
    await page.waitForTimeout(200)
    await page.evaluate(() => { (window as unknown as FixtureWindow).interactions = [] })
    await expect(provider.getAvailability(request)).rejects.toMatchObject({ code: 'PAGE_STRUCTURE_CHANGED' })
    expect(await page.evaluate(() => (window as unknown as FixtureWindow).interactions)).toEqual([])
  }, 10000)

  it('allows a safe retry when the scheduled court refresh stalls before submission', async () => {
    const releaseAt = Date.now() + 2000
    await provider.prepare(request, releaseAt)
    await page.evaluate(() => {
      const fixtureWindow = window as unknown as { selectCourt: (court: number) => void; restoreCourt: () => void }
      const selectCourt = fixtureWindow.selectCourt
      fixtureWindow.restoreCourt = () => { fixtureWindow.selectCourt = selectCourt }
      fixtureWindow.selectCourt = () => undefined
    })
    await expect(provider.getAvailability(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
    await page.evaluate(() => { (window as unknown as { restoreCourt: () => void }).restoreCourt() })
    expect((await provider.getAvailability(request))[0].name).toBe('Court 03-AC-Badminton')
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(0)
  }, 25000)

  it('uses a fallback court only when permitted', async () => {
    const preferred = { ...request, courtPreferences: ['Court 01-AC-Badminton'], allowAnyCourt: false }
    await provider.prepare(preferred)
    expect(await provider.getAvailability(preferred)).toEqual([])
    expect((await provider.getAvailability({ ...preferred, allowAnyCourt: true }))[0].name).toBe('Court 02-AC-Badminton')
  }, 20000)

  it('handles the live shared panel losing its label after AJAX and refreshes without reloading the page', async () => {
    let documentLoads = 0
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => { documentLoads++; return route.fulfill({ contentType: 'text/html', body: fixture(true, false, true) }) })
    await provider.prepare(request)
    expect(documentLoads).toBe(1)
    await page.evaluate(() => { (window as unknown as FixtureWindow).interactions = [] })
    const [court] = await provider.getAvailability(request)
    expect(court.name).toBe('Court 03-AC-Badminton')
    expect(documentLoads).toBe(1)
    const refreshed = await provider.getAvailability(request)
    expect(refreshed[0].name).toBe(court.name)
    const interactions = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
    expect(interactions.map(({ type, value }) => ({ type, value }))).toEqual([{ type: 'court', value: 3 }, { type: 'court', value: 3 }])
    expect(documentLoads).toBe(1)
    expect((await provider.reserve(request, court)).success).toBe(true)
  }, 10000)

  it('waits for the court click to replace stale available slots before selecting', async () => {
    await provider.prepare(request)
    await page.evaluate(() => {
      const state = window as unknown as FixtureWindow
      state.interactions = []
      state.courtsAvailable = false
    })
    expect(await provider.getAvailability(request)).toEqual([])
    const interactions = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
    expect(interactions.map(({ type, value }) => ({ type, value }))).toEqual([
      { type: 'court', value: 3 }, { type: 'court', value: 2 }, { type: 'court', value: 1 }
    ])
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(0)
  }, 10000)

  it('returns no availability for a different start minute', async () => {
    await provider.prepare(request)
    expect(await provider.getAvailability({ ...request, time: '21:00' })).toEqual([])
  }, 20000)

  it('selects a future date when today has no remaining slots', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(true, true) }))
    await provider.prepare(request)
    expect((await provider.getAvailability(request))[0].name).toBe('Court 03-AC-Badminton')
  }, 20000)

  it('can prepare before the requested date enters the picker, even with an empty current day', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(true, true) }))
    const future = { ...request, date: '2030-09-24' }
    await provider.prepare(future)
    await expect(provider.getAvailability(future)).rejects.toMatchObject({ code: 'BOOKING_NOT_OPEN' })
  }, 20000)

  it('does not accept unrelated Booked text or submit again on confirmation recheck', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(false) }))
    await provider.prepare(request)
    const [court] = await provider.getAvailability(request)
    await expect(provider.reserve(request, court)).rejects.toMatchObject({ code: 'BOOKING_CONFIRMATION_FAILED' })
    await page.locator('[role=tabpanel]:visible .action').evaluate(node => { node.textContent = 'Booked' })
    expect((await provider.confirmReservation(request, court)).success).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
  }, 25000)

  it('recognizes the redirected sign-in page instead of reporting a broken page', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: '<script>history.replaceState(null, "", "/home/signin")</script><h1>Sign In</h1>' }))
    expect(await provider.isAuthenticated()).toBe(false)
    await expect(provider.prepare(request)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' })
  })

  it('accepts an explicit server success only for the submitted court, date and slot', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => new URL(route.request().url()).pathname === '/booking/reserve'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Success: true }) })
      : route.fulfill({ contentType: 'text/html', body: fixture(false) }))
    await provider.prepare(request)
    const [court] = await provider.getAvailability(request)
    await page.locator('[role=tabpanel]:visible button').evaluate(node => { node.setAttribute('data-timeslot-id', 'slot3') })
    await page.evaluate(() => {
      (window as unknown as { book: () => void }).book = () => {
        void fetch('/booking/reserve', { method: 'POST', body: new URLSearchParams({ fId: '3', y: '2030', m: '9', d: '23', tsId: 'slot3' }) })
      }
    })
    expect((await provider.reserve(request, court)).success).toBe(true)
    expect(await page.locator('[role=tabpanel]:visible').getByText('Booked', { exact: true }).count()).toBe(0)
  }, 20000)

  it('ignores a success response for another court', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => new URL(route.request().url()).pathname === '/booking/reserve'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Success: true }) })
      : route.fulfill({ contentType: 'text/html', body: fixture(false) }))
    await provider.prepare(request)
    const [court] = await provider.getAvailability(request)
    await page.locator('[role=tabpanel]:visible button').evaluate(node => { node.setAttribute('data-timeslot-id', 'slot3') })
    await page.evaluate(() => {
      (window as unknown as { book: () => void }).book = () => {
        void fetch('/booking/reserve', { method: 'POST', body: new URLSearchParams({ fId: '2', y: '2030', m: '9', d: '23', tsId: 'slot3' }) })
      }
    })
    await expect(provider.reserve(request, court)).rejects.toMatchObject({ code: 'BOOKING_CONFIRMATION_FAILED' })
  }, 25000)

  it('can verify a completed CAPTCHA handoff without another Book click', async () => {
    await page.unrouteAll()
    await page.route('http://booking.test/**', route => new URL(route.request().url()).pathname === '/booking/reserve'
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify({ Success: false, ErrorCode: 100 }) })
      : route.fulfill({ contentType: 'text/html', body: fixture(false) }))
    await provider.prepare(request)
    const [court] = await provider.getAvailability(request)
    await page.locator('[role=tabpanel]:visible button').evaluate(node => { node.setAttribute('data-timeslot-id', 'slot3') })
    await page.evaluate(() => {
      const fixtureWindow = window as unknown as { bookClicks: number; book: () => void }
      fixtureWindow.book = () => {
        fixtureWindow.bookClicks++
        void fetch('/booking/reserve', { method: 'POST', body: new URLSearchParams({ fId: '3', y: '2030', m: '9', d: '23', tsId: 'slot3' }) })
      }
    })
    await expect(provider.reserve(request, court)).rejects.toMatchObject({ code: 'CAPTCHA_REQUIRED' })
    await page.locator('[role=tabpanel]:visible .action').evaluate(node => { node.textContent = 'Booked' })
    expect((await provider.confirmReservation(request, court)).success).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
  }, 10000)
})
