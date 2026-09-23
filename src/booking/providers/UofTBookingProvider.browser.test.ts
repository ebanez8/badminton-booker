import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { BrowserManager } from '../automation/BrowserManager'
import { UofTBookingProvider } from './UofTBookingProvider'
import type { BookingRequest } from '../../shared/types'
import { BookingEngine } from '../BookingEngine'
import { BookingScheduler } from '../BookingScheduler'
import { DateTime } from 'luxon'

const request: BookingRequest = { activity: 'Badminton', date: '2030-09-23', time: '21:10', courtPreferences: ['Court 03-AC-Badminton', 'Court 02-AC-Badminton', 'Court 01-AC-Badminton'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const url = 'http://booking.test/booking/badminton'
// Live U of T rows: "Unavailable" that still lists a spot (not open yet) and your own reservation.
const closedWithSpotRow = (court: number, label: string): string => `<div class="booking-slot-item" data-slot-number="1"><div class="booking-slot-item-right booking-slot-action-item"><button class="btn btn-primary disabled" type="button" aria-label="Court 0${court}-AC-Badminton booking from undefined with undefined Unavailable">Unavailable</button></div><p role="heading" aria-level="3"><span class="sr-only">Booking for current date and facility</span><strong>${label}</strong><span class="sr-only">1 spot available</span></p><span>1 spot available</span></div>`
const bookedByYouRow = (label: string): string => `<div class="booking-slot-item" data-slot-number="1"><div class="booking-slot-item-right booking-slot-reserved-item"><div class="btn-group"><button type="button" class="button-without-style"><span class="text-primary"><span class="material-icons-round md-18 mr-2">done</span>Booked</span></button></div></div><p role="heading" aria-level="3"><strong>${label}</strong><span class="sr-only">No spots available</span></p><span>No spots available</span></div>`
type FixtureInteraction = { type: 'date' | 'court'; value: number; at: number }
type FixtureWindow = { interactions: FixtureInteraction[]; courtsAvailable: boolean; notOpen: boolean }

// Reproduces the inspected Fusion DOM: hidden duplicate dates, lazy court panels,
// repeated slot numbers across courts, and date selection preceding schedule refresh.
function fixture(confirm = true, emptyToday = false, sharedPanel = false): string {
  return `<main><div id="app"></div><div>Booked</div></main><script>
    let day = 21, court = 1;
    window.bookClicks = 0;
    window.interactions = [];
    window.courtsAvailable = true;
    window.notOpen = false;
    function dates() {
      return [21, 23].map(d => '<div hidden><button class="single-date-select-button single-date-select-two-click" data-year="2030" data-month="9" data-day="'+d+'">'+d+'</button></div><button onclick="selectDate('+d+')" class="single-date-select-button single-date-select-one-click" data-year="2030" data-month="9" data-day="'+d+'" '+(d===day?'aria-current="date"':'')+'>'+d+'</button>').join('');
    }
    function slots(n) {
      if (${emptyToday} && day === 21) return '';
      const name = 'Court 0'+n+'-AC-Badminton';
      const available = n > 1 && window.courtsAvailable;
      if (window.notOpen) return '<div class="booking-slot-item" data-slot-number="1"><div class="booking-slot-item-right booking-slot-reserved-item"><span>Opens at 9 PM</span></div><strong>'+(day===23?'9:10 - 9:55 PM':'7 - 7:55 AM')+'</strong><span>1 spot available</span></div>';
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

  it('keeps clicking the court from before release and clicks Book the moment the slot opens', async () => {
    const releaseAt = Date.now() + 3000
    const prepared = { ...request, ...(() => {
      const desired = DateTime.fromMillis(releaseAt).setZone('America/Toronto').plus({ hours: 48 })
      return { date: desired.toISODate()!, time: desired.toFormat('HH:mm') }
    })() }
    const scheduler = new BookingScheduler()
    const scheduledArm = scheduler.arm.bind(scheduler)
    scheduler.arm = (_at, callbacks) => scheduledArm(releaseAt, callbacks)
    let finished!: () => void
    const done = new Promise<void>(resolve => { finished = resolve })
    const engine = new BookingEngine({
      initialize: async () => undefined, isAuthenticated: async () => true, requestAuthentication: async () => undefined,
      prepare: async () => {
        await provider.prepare(request, releaseAt)
        // The slot opens exactly at release; before that the row shows "Opens at".
        await page.evaluate(at => {
          const fixtureWindow = window as unknown as FixtureWindow
          fixtureWindow.interactions = []
          fixtureWindow.notOpen = true
          setTimeout(() => { fixtureWindow.notOpen = false }, at - Date.now())
        }, releaseAt)
      },
      getAvailability: async () => provider.getAvailability(request),
      waitForReleaseClick: async () => provider.waitForReleaseClick(request),
      reserve: async (_request, court) => provider.reserve(request, court),
      confirmReservation: async (_request, court) => provider.confirmReservation(request, court), close: async () => undefined
    }, scheduler, { maxRetries: 1, retryDelayMs: 250, saveHistory: async () => undefined, logger: { info: async () => undefined } })
    engine.subscribe(state => { if (['confirmed', 'failed', 'confirmation-required'].includes(state.status)) finished() })
    try {
      await engine.arm(prepared)
      await done
      expect(engine.getState().status).toBe('confirmed')
      expect(engine.getState().result?.court).toBe('Court 03-AC-Badminton')
      expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
      const clicks = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
      expect(clicks.length).toBeGreaterThan(2)
      expect(clicks.every(click => click.type === 'court' && click.value === 3)).toBe(true)
      expect(clicks[0].at).toBeLessThan(releaseAt)
      const bookAt = Date.parse(engine.getState().timing!.submissionStartedAt!)
      expect(bookAt).toBeGreaterThanOrEqual(releaseAt)
      // One fixture refresh takes 100 ms; Book must follow the first refresh that shows the slot open.
      expect(bookAt - releaseAt).toBeLessThan(400)
      console.log(`Release loop fixture: ${clicks.length} court clicks, first at ${clicks[0].at - releaseAt} ms; Book clicked +${bookAt - releaseAt} ms after release.`)
    } finally { await engine.close() }
  }, 15000)

  it('moves to the next preferred court when the first slot is already taken', async () => {
    const releaseAt = Date.now() + 3000
    await provider.prepare(request, releaseAt)
    await page.evaluate(() => {
      const fixtureWindow = window as unknown as { slots: (n: number) => string }
      const slots = fixtureWindow.slots
      fixtureWindow.slots = n => n === 3 ? slots(n).replace(/<div class="action">[\s\S]*<\/div><\/div>$/, '<div class="action"><span>Booked</span></div></div>') : slots(n)
    })
    const clicked = await provider.waitForReleaseClick(request)
    expect(clicked?.court.name).toBe('Court 02-AC-Badminton')
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
    expect((await provider.confirmReservation(request, clicked!.court)).success).toBe(true)
  }, 10000)

  it('fails without booking when the slot is Unavailable on every court', async () => {
    const releaseAt = Date.now() + 3000
    await provider.prepare(request, releaseAt)
    await page.evaluate(() => { const fixtureWindow = window as unknown as FixtureWindow; fixtureWindow.courtsAvailable = false; fixtureWindow.interactions = [] })
    await expect(provider.waitForReleaseClick(request)).rejects.toMatchObject({ code: 'NO_AVAILABLE_COURTS' })
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(0)
    const courts = (await page.evaluate(() => (window as unknown as FixtureWindow).interactions)).map(click => click.value)
    expect(courts.slice(-2)).toEqual([2, 1])
  }, 15000)

  it('spaces court clicks 20-50 ms apart', async () => {
    const releaseAt = Date.now() + 2500
    await provider.prepare(request, releaseAt)
    await page.evaluate(() => {
      const fixtureWindow = window as unknown as FixtureWindow & { selectCourt: (court: number) => void }
      fixtureWindow.notOpen = true
      // Answer refreshes instantly so the spacing, not the fixture, sets the pace.
      fixtureWindow.selectCourt = court => { fixtureWindow.interactions.push({ type: 'court', value: court, at: Date.now() }); (window as unknown as { render: () => void }).render() }
      fixtureWindow.interactions = []
    })
    await page.waitForTimeout(1500)
    const clicks = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
    await provider.close()
    const gaps = clicks.slice(1).map((click, index) => click.at - clicks[index].at)
    expect(gaps.length).toBeGreaterThan(5)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(19)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(70)
  }, 10000)

  it('reads every listed date and court into the calendar schedule', async () => {
    expect(await provider.isAuthenticated()).toBe(true)
    // Courts 2 and 3 show "Opens at" on the later date; court 1 is Unavailable everywhere.
    await page.evaluate(() => {
      const fixtureWindow = window as unknown as FixtureWindow & { slots: (n: number) => string }
      const slots = fixtureWindow.slots
      fixtureWindow.slots = n => { fixtureWindow.notOpen = n > 1 && document.querySelector('[data-day="23"][aria-current="date"]') !== null; return slots(n) }
    })
    const days = await provider.getSchedule()
    expect(days.map(day => day.date)).toEqual(['2030-09-21', '2030-09-23'])
    expect(days[0].slots).toEqual([{ time: '07:00', label: '7 - 7:55 AM', courts: [
      { court: 'Court 01-AC-Badminton', status: 'unavailable', note: 'No spots available' },
      { court: 'Court 02-AC-Badminton', status: 'open' },
      { court: 'Court 03-AC-Badminton', status: 'open' }
    ] }])
    expect(days[1].slots).toEqual([{ time: '21:10', label: '9:10 - 9:55 PM', courts: [
      { court: 'Court 01-AC-Badminton', status: 'unavailable', note: 'No spots available' },
      { court: 'Court 02-AC-Badminton', status: 'opens-later', note: 'Opens at 9 PM' },
      { court: 'Court 03-AC-Badminton', status: 'opens-later', note: 'Opens at 9 PM' }
    ] }])
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(0)
  }, 20000)

  it('reads your own booking and "Unavailable, 1 spot available" the way U of T means them', async () => {
    expect(await provider.isAuthenticated()).toBe(true)
    await page.evaluate(({ closed, booked }) => {
      const fixtureWindow = window as unknown as { slots: (n: number) => string }
      const slots = fixtureWindow.slots
      const onThursday = (): boolean => document.querySelector('[data-day="23"][aria-current="date"]') !== null
      fixtureWindow.slots = n => !onThursday() ? slots(n) : n === 3 ? booked : n === 2 ? closed : slots(n)
    }, { closed: closedWithSpotRow(2, '9:10 - 9:55 PM'), booked: bookedByYouRow('9:10 - 9:55 PM') })
    const [, thursday] = await provider.getSchedule()
    expect(thursday.slots[0].courts).toEqual([
      { court: 'Court 01-AC-Badminton', status: 'unavailable', note: 'No spots available' },
      { court: 'Court 02-AC-Badminton', status: 'opens-later', note: 'Unavailable, 1 spot left: not open yet' },
      { court: 'Court 03-AC-Badminton', status: 'booked', note: 'Booked by you' }
    ])
  }, 20000)

  it('keeps clicking a court that shows "Unavailable, 1 spot available" and books it when it opens', async () => {
    const releaseAt = Date.now() + 2500
    await provider.prepare(request, releaseAt)
    await page.evaluate(({ at, rows }) => {
      const fixtureWindow = window as unknown as FixtureWindow & { slots: (n: number) => string }
      const slots = fixtureWindow.slots
      fixtureWindow.slots = n => Date.now() < at ? rows[n - 1] : slots(n)
      fixtureWindow.interactions = []
    }, { at: releaseAt, rows: [1, 2, 3].map(n => closedWithSpotRow(n, '9:10 - 9:55 PM')) })
    const clicked = await provider.waitForReleaseClick(request)
    expect(clicked?.court.name).toBe('Court 03-AC-Badminton')
    expect(clicked!.clickedAt).toBeGreaterThanOrEqual(releaseAt)
    const clicks = await page.evaluate(() => (window as unknown as FixtureWindow).interactions)
    // Never treated as taken: it stayed on Court 03 the whole time.
    expect(clicks.length).toBeGreaterThan(3)
    expect(clicks.every(click => click.value === 3)).toBe(true)
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(1)
  }, 15000)

  it('confirms a booking from the live "Booked" marker', async () => {
    await provider.prepare(request)
    const [court] = await provider.getAvailability(request)
    await page.evaluate(booked => {
      const fixtureWindow = window as unknown as { book: (button: HTMLElement) => void; bookClicks: number }
      fixtureWindow.book = button => { fixtureWindow.bookClicks++; setTimeout(() => { button.closest('.booking-slot-item')!.outerHTML = booked }, 100) }
    }, bookedByYouRow('9:10 - 9:55 PM'))
    expect((await provider.reserve(request, court)).success).toBe(true)
  }, 20000)

  it('lists a date with no slots left as empty instead of failing', async () => {
    await page.route('http://booking.test/**', route => route.fulfill({ contentType: 'text/html', body: fixture(true, true) }))
    expect(await provider.isAuthenticated()).toBe(true)
    const days = await provider.getSchedule()
    expect(days.map(day => [day.date, day.slots.length])).toEqual([['2030-09-21', 0], ['2030-09-23', 1]])
  }, 20000)

  it('stops the release loop without booking if the prepared date was changed', async () => {
    const releaseAt = Date.now() + 1500
    await provider.prepare(request, releaseAt)
    await page.locator('button.single-date-select-one-click[data-day="21"]').click()
    await expect(provider.waitForReleaseClick(request)).rejects.toMatchObject({ code: 'PAGE_STRUCTURE_CHANGED' })
    expect(await page.evaluate(() => (window as unknown as { bookClicks: number }).bookClicks)).toBe(0)
  }, 10000)

  it('stops clicking once the release loop is closed', async () => {
    await provider.prepare(request, Date.now() + 1500)
    await page.waitForTimeout(300)
    await provider.getAvailability(request)
    const count = (await page.evaluate(() => (window as unknown as FixtureWindow).interactions)).length
    await page.waitForTimeout(700)
    expect((await page.evaluate(() => (window as unknown as FixtureWindow).interactions)).length).toBe(count)
  }, 10000)

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
