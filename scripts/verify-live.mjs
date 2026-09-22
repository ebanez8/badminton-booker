// Runs the actual provider against the live site. Only authentication, preparation,
// and availability are callable here; this diagnostic never submits a reservation.
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const dataDirectory = process.argv[2]
if (!dataDirectory) throw new Error('Pass the app user-data directory')
const settings = JSON.parse(await readFile(join(dataDirectory, 'settings.json'), 'utf8'))
const output = resolve('out/diagnostics')
await build({ entryPoints: ['src/booking/automation/BrowserManager.ts'], outfile: join(output, 'browser.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm' })
const { BrowserManager } = await import(pathToFileURL(join(output, 'browser.mjs')).href)
const manager = new BrowserManager(join(dataDirectory, 'browser-profile'), true)
const page = await manager.initialize()
await page.goto(settings.bookingUrl, { waitUntil: 'domcontentloaded' })
if (page.url().includes('/home/signin')) {
  console.log('Waiting for manual sign-in. This browser remains open throughout checks.')
  await page.waitForURL(url => url.origin === new URL(settings.bookingUrl).origin && !url.pathname.includes('signin'), { timeout: 600000 })
  await page.goto(settings.bookingUrl, { waitUntil: 'domcontentloaded' })
}
await page.locator('.single-date-select-one-click:visible').first().waitFor({ timeout: 20000 })
console.log('Authenticated. Commands: check YYYY-MM-DD HH:mm, inspect, refresh, quit. Reservation submission is disabled.')
const input = createInterface({ input: process.stdin, output: process.stdout })
try {
  for await (const command of input) {
    if (command === 'quit') break
    try {
      if (command.startsWith('check ')) {
        const [, date, time] = command.trim().split(/\s+/)
        await build({ entryPoints: ['src/booking/providers/UofTBookingProvider.ts'], outfile: join(output, 'provider.mjs'), bundle: true, packages: 'external', platform: 'node', format: 'esm' })
        const { UofTBookingProvider } = await import(pathToFileURL(join(output, 'provider.mjs')).href + `?v=${Date.now()}`)
        const provider = new UofTBookingProvider(manager, settings.bookingUrl)
        const request = { activity: 'Badminton', date, time, courtPreferences: settings.defaultCourtOrder, allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
        console.log('Authenticated:', await provider.isAuthenticated())
        const preparedAt = performance.now()
        await provider.prepare(request)
        console.log('Prepared:', date, time, 'in', Math.round(performance.now() - preparedAt), 'ms')
        const availabilityAt = performance.now()
        const requests = []
        const observed = outgoing => { if (['document', 'xhr', 'fetch'].includes(outgoing.resourceType())) requests.push({ type: outgoing.resourceType(), method: outgoing.method(), path: new URL(outgoing.url()).pathname }) }
        page.on('request', observed)
        try { console.log('Availability:', JSON.stringify(await provider.getAvailability(request))) }
        finally { page.off('request', observed) }
        console.log('Availability check:', Math.round(performance.now() - availabilityAt), 'ms')
        console.log('Availability requests:', JSON.stringify(requests))
      }
      if (command === 'refresh') {
        const paths = []
        const observed = request => { if (['xhr', 'fetch'].includes(request.resourceType())) paths.push({ method: request.method(), path: new URL(request.url()).pathname }) }
        page.on('request', observed)
        const oldRow = (await page.locator('.booking-slot-item:visible').first().elementHandles())[0]
        const started = performance.now()
        try {
          await page.locator('.single-date-select-one-click[aria-current=date]:visible').click()
          if (oldRow) await oldRow.waitForElementState('hidden', { timeout: 10000 })
          await page.locator('.booking-slot-item:visible').first().waitFor({ timeout: 10000 })
          console.log('Selected-date refresh:', Math.round(performance.now() - started), 'ms; observed requests:', JSON.stringify(paths))
        } finally { page.off('request', observed) }
      }
      console.log('Selected date:', await page.locator('.single-date-select-one-click[aria-current=date]').getAttribute('data-date-text'))
      console.log('Court controls:', await page.locator('button').filter({ hasText: /^\s*Court 0[123]-AC-Badminton\s*$/ }).evaluateAll(nodes => nodes.map(n => ({ id: n.id, role: n.getAttribute('role'), selected: n.getAttribute('aria-selected') }))))
      console.log('Visible slots:', await page.locator('.booking-slot-item:visible').evaluateAll(nodes => nodes.map(n => n.innerText.replace(/\s+/g, ' ').trim())))
    } catch (error) { console.log('CHECK FAILED:', error.code ?? error.name, error.message) }
  }
} finally { input.close(); await manager.close() }
