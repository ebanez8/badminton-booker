import { _electron as electron } from 'playwright'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'

const output = resolve('out/diagnostics')
await mkdir(output, { recursive: true })
const dataDirectory = await mkdtemp(join(output, 'smoke-'))
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
async function launch() {
  const app = await electron.launch({ args: ['.', `--user-data-dir=${dataDirectory}`], cwd: process.cwd(), env })
  assert.equal(resolve(await app.evaluate(({ app }) => app.getPath('userData'))), dataDirectory, 'Smoke test must use isolated user data')
  return app
}
let app = await launch()
try {
  let page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Court Booker', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => typeof window.bookingAPI.armBooking), 'function')
  const date = await page.getByLabel('Date', { exact: true }).inputValue()
  assert.ok(date > new Date().toISOString().slice(0, 10), 'Default booking date must be in the future')
  const rejected = await page.evaluate(() => window.bookingAPI.armBooking(null))
  assert.equal(rejected.status, 'failed')
  await page.getByLabel('Availability attempts').fill('2')
  await page.getByRole('button', { name: 'SAVE SETTINGS' }).click()
  await page.getByText('Settings saved and applied.').waitFor()
  assert.equal((await page.evaluate(() => window.bookingAPI.getSettings())).maxRetries, 2)
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true })
  assert.deepEqual(errors, [])
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.getByRole('heading', { name: 'Court Booker', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.bookingAPI.getSettings())).maxRetries, 2)
  assert.equal(await page.getByLabel('Availability attempts').inputValue(), '2')
  console.log('PASS: desktop startup, preload IPC, future default date, malformed request handling, settings apply/save/restart, renderer without errors.')
  console.log('Screenshot:', join(output, 'desktop.png'))
} finally { await app.close() }
