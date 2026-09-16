import { useEffect, useMemo, useState } from 'react'
import { DateTime } from 'luxon'
import { calculateReleaseDateTime } from '../booking/logic/releaseTime'
import type { AppSettings, BookingHistoryEntry, BookingRequest, BookingState } from '../shared/types'

const initialRequest: BookingRequest = { activity: 'Badminton', date: '2026-09-20', time: '19:00', courtPreferences: ['Court 03-AC-Badminton', 'Court 02-AC-Badminton', 'Court 01-AC-Badminton'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const initialState: BookingState = { status: 'idle', message: 'Ready to configure booking.', updatedAt: new Date().toISOString() }

export function App() {
  const [request, setRequest] = useState(initialRequest)
  const [state, setState] = useState(initialState)
  const [courts, setCourts] = useState('Court 03-AC-Badminton\nCourt 02-AC-Badminton\nCourt 01-AC-Badminton')
  const [settings, setSettings] = useState<AppSettings>()
  const [history, setHistory] = useState<BookingHistoryEntry[]>([])
  useEffect(() => {
    void window.bookingAPI.getState().then(setState)
    void window.bookingAPI.getSettings().then(setSettings)
    void window.bookingAPI.getHistory().then(setHistory)
    return window.bookingAPI.onStateChange((next) => { setState(next); if (next.status === 'confirmed') void window.bookingAPI.getHistory().then(setHistory) })
  }, [])
  const releaseText = useMemo(() => {
    try { return calculateReleaseDateTime(request).toLocaleString(DateTime.DATETIME_MED) } catch { return 'Enter valid Toronto time' }
  }, [request])
  const arm = async (): Promise<void> => {
    const preferences = courts.split('\n').map((item) => item.trim()).filter(Boolean)
    setState(await window.bookingAPI.armBooking({ ...request, courtPreferences: preferences }))
  }
  const locked = !['idle', 'failed', 'cancelled', 'confirmed', 'login-required'].includes(state.status)
  return <main>
    <header><p className="eyebrow">UNIVERSITY OF TORONTO RECREATION</p><h1>Court Booker</h1><p>Prepare one future court booking. Login stays in your private local browser profile.</p></header>
    <section className="card status"><span className={`dot ${state.status}`} /> <div><b>{state.status.replaceAll('-', ' ')}</b><p>{state.message}</p>{state.error?.technicalMessage && <details><summary>Attempt details</summary><pre>{state.error.technicalMessage}</pre></details>}</div>{state.status === 'login-required' && <button onClick={() => void window.bookingAPI.openLogin()}>RECHECK LOGIN &amp; ARM</button>}{state.status === 'confirmation-required' && <button onClick={() => void window.bookingAPI.confirmReservation()}>CONFIRM BOOKING</button>}</section>
    <section className="grid">
      <form className="card" onSubmit={(event) => { event.preventDefault(); void arm() }}>
        <h2>Booking details</h2>
        <label>Activity<input value={request.activity} onChange={(event) => setRequest({ ...request, activity: event.target.value })} /></label>
        <div className="split"><label>Date<input type="date" value={request.date} onChange={(event) => setRequest({ ...request, date: event.target.value })} /></label><label>Time<input type="time" value={request.time} onChange={(event) => setRequest({ ...request, time: event.target.value })} /></label></div>
        <label>Court priority <small>One court per line, first wins.</small><textarea value={courts} onChange={(event) => setCourts(event.target.value)} rows={5} /></label>
        <label className="check"><input type="checkbox" checked={request.allowAnyCourt} onChange={(event) => setRequest({ ...request, allowAnyCourt: event.target.checked })} /> Any available court</label>
        <label>Booking release
          <select value={request.releaseRule.mode} onChange={(event) => {
            const mode = event.target.value === 'exact-date-time' ? 'exact-date-time' : 'offset-hours'
            setRequest({ ...request, releaseRule: { mode, offsetHours: 48 } })
          }}>
            <option value="offset-hours">Hours before</option><option value="exact-date-time">Exact time</option>
          </select>
        </label>
        {request.releaseRule.mode === 'offset-hours' ? (
          <label>Hours before<input type="number" min="0" value={request.releaseRule.offsetHours ?? 48} onChange={(event) => {
            setRequest({ ...request, releaseRule: { mode: 'offset-hours', offsetHours: Number(event.target.value) } })
          }} /></label>
        ) : (
          <label>Exact release<input type="datetime-local" onChange={(event) => {
            setRequest({ ...request, releaseRule: { mode: 'exact-date-time', dateTime: event.target.value } })
          }} /></label>
        )}
        <div className="release"><span>Calculated release</span><b>{releaseText}</b></div>
        <div className="actions"><button className="primary" disabled={locked}>ARM BOOKING</button>{locked && <button type="button" onClick={() => void window.bookingAPI.cancelBooking()}>CANCEL</button>}</div>
      </form>
      <aside className="card"><h2>Result</h2>{state.result ? <><strong className="success">BOOKING CONFIRMED</strong><p>{state.result.court}</p><p>{state.result.date} · {state.result.time}</p><p>Confirmation: {state.result.confirmationNumber ?? 'Recorded by provider'}</p></> : <p>Booking confirmation appears here after provider verifies reservation.</p>}<h2>Safety</h2><p>CAPTCHA and MFA require your action in visible browser. App never stores credentials in UI or history.</p></aside>
    </section>
    {settings && <section className="grid lower"><section className="card"><h2>Settings</h2><div className="split"><label>Default release hours<input type="number" min="0" value={settings.defaultReleaseOffsetHours} onChange={(event) => setSettings({ ...settings, defaultReleaseOffsetHours: Number(event.target.value) })} /></label><label>Retry count<input type="number" min="1" max="5" value={settings.maxRetries} onChange={(event) => setSettings({ ...settings, maxRetries: Number(event.target.value) })} /></label></div><label>Retry delay (ms)<input type="number" min="250" value={settings.retryDelayMs} onChange={(event) => setSettings({ ...settings, retryDelayMs: Number(event.target.value) })} /></label><label className="check"><input type="checkbox" checked={settings.showBrowser} onChange={(event) => setSettings({ ...settings, showBrowser: event.target.checked })} /> Show browser</label><button type="button" onClick={() => void window.bookingAPI.saveSettings(settings)}>SAVE SETTINGS</button></section><section className="card"><h2>Booking history</h2>{history.length ? <ul>{history.map((entry) => <li key={entry.id}><b>{entry.activity} · {entry.court}</b><br />{entry.date} {entry.time}<br /><small>{entry.confirmationNumber ?? 'Confirmed'}</small></li>)}</ul> : <p>No confirmed bookings yet.</p>}</section></section>}
  </main>
}
