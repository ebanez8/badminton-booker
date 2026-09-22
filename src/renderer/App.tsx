import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { calculateReleaseDateTime } from '../booking/logic/releaseTime'
import type { AppSettings, BookingHistoryEntry, BookingRequest, BookingState } from '../shared/types'

const initialRequest: BookingRequest = { activity: 'Badminton', date: DateTime.now().setZone('America/Toronto').plus({ days: 2 }).toISODate()!, time: '19:00', courtPreferences: ['Court 03-AC-Badminton', 'Court 02-AC-Badminton', 'Court 01-AC-Badminton'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const initialState: BookingState = { status: 'idle', message: 'Ready to configure booking.', updatedAt: new Date().toISOString() }

export function App() {
  const [request, setRequest] = useState(initialRequest)
  const [state, setState] = useState(initialState)
  const [courts, setCourts] = useState('Court 03-AC-Badminton\nCourt 02-AC-Badminton\nCourt 01-AC-Badminton')
  const [settings, setSettings] = useState<AppSettings>()
  const [history, setHistory] = useState<BookingHistoryEntry[]>([])
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const failed = () => setNotice('Could not communicate with the desktop app. Restart Court Booker and try again.')
    void window.bookingAPI.getState().then(setState).catch(failed)
    void window.bookingAPI.getSettings().then((saved) => {
      setSettings(saved)
      setCourts(saved.defaultCourtOrder.join('\n'))
      setRequest((current) => ({ ...current, courtPreferences: saved.defaultCourtOrder, allowAnyCourt: saved.allowAnyCourt }))
    }).catch(failed)
    void window.bookingAPI.getHistory().then(setHistory).catch(failed)
    return window.bookingAPI.onStateChange((next) => { setState(next); if (next.status === 'confirmed') void window.bookingAPI.getHistory().then(setHistory).catch(failed) })
  }, [])
  const releaseText = useMemo(() => {
    try { return calculateReleaseDateTime(request).toLocaleString(DateTime.DATETIME_MED) } catch { return 'Enter valid Toronto time' }
  }, [request])
  const arm = async (): Promise<void> => {
    const preferences = courts.split('\n').map((item) => item.trim()).filter(Boolean)
    setNotice('')
    try { setState(await window.bookingAPI.armBooking({ ...request, courtPreferences: preferences })) }
    catch { setNotice('Unable to arm booking. Check the desktop app and try again.') }
  }
  const runAction = (action: () => Promise<unknown>): void => { void action().catch(() => setNotice('The action failed. Check the booking browser and try again.')) }
  const locked = !['idle', 'failed', 'cancelled', 'confirmed', 'login-required'].includes(state.status)
  return <main>
    <header><p className="eyebrow">UNIVERSITY OF TORONTO RECREATION</p><h1>Court Booker</h1><p>Prepare one future court booking. Login stays in your private local browser profile.</p></header>
    <section className="card status" aria-live="polite"><span className={`dot ${state.status}`} /> <div><b>{state.status.replaceAll('-', ' ')}</b><p>{state.message}</p>{state.error?.technicalMessage && <details><summary>Attempt details</summary><pre>{state.error.technicalMessage}</pre></details>}</div>{state.status === 'login-required' && <button onClick={() => runAction(() => window.bookingAPI.openLogin())}>RECHECK LOGIN &amp; ARM</button>}{state.status === 'confirmation-required' && <button onClick={() => runAction(() => window.bookingAPI.confirmReservation())}>RECHECK RESERVATION</button>}</section>
    {notice && <p role="status">{notice}</p>}
    {state.timing?.releaseStartedAt && <p role="status">Release check started {state.timing.releaseDelayMs} ms after the scheduled time.{state.timing.submissionStartedAt && ` Reservation step started ${Date.parse(state.timing.submissionStartedAt) - Date.parse(state.timing.releaseStartedAt)} ms after that.`}</p>}
    <section className="grid">
      <form className="card" onSubmit={(event) => { event.preventDefault(); void arm() }}>
        <h2>Booking details</h2>
        <fieldset disabled={locked}>
        <label>Activity<input value={request.activity} readOnly /></label>
        <div className="split"><label>Date<input type="date" required min={DateTime.now().setZone('America/Toronto').toISODate()!} value={request.date} onChange={(event) => setRequest({ ...request, date: event.target.value })} /></label><label>Time (Toronto)<input type="time" required value={request.time} onChange={(event) => setRequest({ ...request, time: event.target.value })} /></label></div>
        <label>Court priority <small>One court per line, first wins.</small><textarea value={courts} onChange={(event) => setCourts(event.target.value)} rows={5} /></label>
        <label className="check"><input type="checkbox" checked={request.allowAnyCourt} onChange={(event) => setRequest({ ...request, allowAnyCourt: event.target.checked })} /> Any available court</label>
        <p>U of T releases bookings 48 hours before the start time. Enter the exact start time shown on the booking site.</p>
        <div className="release"><span>Calculated release · Toronto time</span><b>{releaseText}</b><small>If release has passed, the app checks availability immediately.</small></div>
        </fieldset>
        <div className="actions"><button className="primary" disabled={locked}>ARM BOOKING</button>{locked && !['reserving', 'confirming'].includes(state.status) && <button type="button" onClick={() => runAction(() => window.bookingAPI.cancelBooking())}>{state.status === 'confirmation-required' ? 'STOP CHECKING' : 'CANCEL'}</button>}</div>
      </form>
      <aside className="card"><h2>Result</h2>{state.result ? <><strong className="success">BOOKING CONFIRMED</strong><p>{state.result.court}</p><p>{state.result.date} · {state.result.time}</p><p>Confirmation: {state.result.confirmationNumber ?? 'Recorded by provider'}</p></> : <p>Booking confirmation appears here after provider verifies reservation.</p>}<h2>Safety</h2><p>CAPTCHA and MFA require your action in visible browser. App never stores credentials in UI or history.</p></aside>
    </section>
    {settings && <section className="grid lower">
      <section className="card"><h2>Settings</h2>
        <fieldset disabled={!['idle', 'failed', 'cancelled', 'confirmed'].includes(state.status)}>
          <label>Availability attempts<input type="number" min="1" max="5" value={settings.maxRetries} onChange={(event) => setSettings({ ...settings, maxRetries: Number(event.target.value) })} /></label>
          <label>Retry delay (ms)<input type="number" min="250" max="60000" value={settings.retryDelayMs} onChange={(event) => setSettings({ ...settings, retryDelayMs: Number(event.target.value) })} /></label>
          <label className="check"><input type="checkbox" checked={settings.showBrowser} onChange={(event) => setSettings({ ...settings, showBrowser: event.target.checked })} /> Show browser immediately (always shown before booking)</label>
          <button type="button" onClick={() => runAction(async () => {
            const saved = await window.bookingAPI.saveSettings(settings)
            setSettings(saved)
            setNotice('Settings saved and applied.')
          })}>SAVE SETTINGS</button>
        </fieldset>
      </section>
      <section className="card"><h2>Booking history</h2>{history.length ? <ul>{history.map((entry) => <li key={entry.id}><b>{entry.activity} · {entry.court}</b><br />{entry.date} {entry.time}<br /><small>{entry.confirmationNumber ?? 'Confirmed'}</small></li>)}</ul> : <p>No confirmed bookings yet.</p>}</section>
    </section>}
  </main>
}
