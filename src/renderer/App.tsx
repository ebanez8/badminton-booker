import { useCallback, useEffect, useState } from 'react'
import { DateTime } from 'luxon'
import { calculateReleaseDateTime, TORONTO_ZONE } from '../booking/logic/releaseTime'
import type { BookingHistoryEntry, BookingRequest, BookingState, BookingStatus, ScheduleResult } from '../shared/types'
import { RELEASE_TIMING } from '../shared/releaseTiming'
import { COURTS, slotView } from './slots'

const shortCourt = (court: string): string => court.replace(/-AC-Badminton$/, '')
const initialState: BookingState = { status: 'idle', message: 'Ready to configure booking.', updatedAt: new Date().toISOString() }
const editable = (status: BookingStatus): boolean => ['idle', 'failed', 'cancelled', 'confirmed', 'login-required'].includes(status)
const shortTime = (label: string): string => `${label.split(/\s*-\s*/)[0]} ${label.slice(-2)}`

export function App() {
  const [state, setState] = useState(initialState)
  const [history, setHistory] = useState<BookingHistoryEntry[]>([])
  const [notice, setNotice] = useState('')
  const [schedule, setSchedule] = useState<ScheduleResult>()
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleNotice, setScheduleNotice] = useState('')
  const [activeDate, setActiveDate] = useState<string>()
  const [selected, setSelected] = useState<{ date: string; time: string }>()
  const [chosen, setChosen] = useState<string[]>(COURTS)

  const loadSchedule = useCallback(async (): Promise<void> => {
    setScheduleLoading(true)
    setScheduleNotice('')
    try {
      const result = await window.bookingAPI.getSchedule()
      setSchedule(result)
      if (result.loginRequired) setScheduleNotice('Sign in to U of T in the booking browser window, then press Refresh schedule.')
      else if (!result.days.length) setScheduleNotice('U of T listed no dates. Press Refresh schedule to try again.')
      // Keep the open date if it is still listed; otherwise jump to the first date with something to arm.
      setActiveDate((current) => result.days.some((day) => day.date === current) ? current
        : (result.days.find((day) => day.slots.some((slot) => slotView(day, slot, COURTS).armable)) ?? result.days[0])?.date)
    } catch { setScheduleNotice('Could not read the U of T schedule. Press Refresh schedule to try again.') }
    finally { setScheduleLoading(false) }
  }, [])

  useEffect(() => {
    const failed = () => setNotice('Could not communicate with the desktop app. Restart Court Booker and try again.')
    void window.bookingAPI.getState().then((current) => {
      setState(current)
      // Show what an already-armed booking is fighting for.
      if (current.request) {
        setSelected({ date: current.request.date, time: current.request.time })
        setActiveDate(current.request.date)
        setChosen(COURTS.filter((court) => current.request!.courtPreferences.includes(court)))
      }
      if (editable(current.status)) void loadSchedule()
    }).catch(failed)
    void window.bookingAPI.getSettings().then((saved) => {
      const courts = COURTS.filter((court) => saved.defaultCourtOrder.includes(court))
      setChosen((current) => current === COURTS && courts.length ? courts : current)
    }).catch(failed)
    void window.bookingAPI.getHistory().then(setHistory).catch(failed)
    return window.bookingAPI.onStateChange((next) => { setState(next); if (next.status === 'confirmed') void window.bookingAPI.getHistory().then(setHistory).catch(failed) })
  }, [loadSchedule])

  const courts = COURTS.filter((court) => chosen.includes(court))
  const days = schedule?.days ?? []
  const activeDay = days.find((day) => day.date === activeDate)
  const selectedDay = days.find((day) => day.date === selected?.date)
  const selectedSlot = selectedDay?.slots.find((slot) => slot.time === selected?.time)
  const request: BookingRequest | undefined = selected && courts.length ? {
    activity: 'Badminton', date: selected.date, time: selected.time, courtPreferences: courts,
    allowAnyCourt: false, releaseRule: { mode: 'offset-hours', offsetHours: 48 }
  } : undefined
  const release = request && calculateReleaseDateTime(request)
  const releaseText = !release ? (selected ? 'Choose at least one court' : 'Pick a time above')
    : release <= DateTime.now() ? 'Already released: arming checks right away' : release.toLocaleString(DateTime.DATETIME_MED)
  const arm = async (): Promise<void> => {
    if (!request) return
    setNotice('')
    try { setState(await window.bookingAPI.armBooking(request)) }
    catch { setNotice('Unable to arm booking. Check the desktop app and try again.') }
  }
  const runAction = (action: () => Promise<unknown>): void => { void action().catch(() => setNotice('The action failed. Check the booking browser and try again.')) }
  const locked = !editable(state.status)
  const selectedArmable = !selectedDay || !selectedSlot || slotView(selectedDay, selectedSlot, courts).armable
  return <main>
    <header><p className="eyebrow">UNIVERSITY OF TORONTO RECREATION</p><h1>Court Booker</h1><p>Prepare one future court booking. Login stays in your private local browser profile.</p></header>
    <section className="card status" aria-live="polite"><span className={`dot ${state.status}`} /> <div><b>{state.status.replaceAll('-', ' ')}</b><p>{state.message}</p>{state.error?.technicalMessage && <details><summary>Attempt details</summary><pre>{state.error.technicalMessage}</pre></details>}</div>{state.status === 'login-required' && <button onClick={() => runAction(() => window.bookingAPI.openLogin())}>RECHECK LOGIN &amp; ARM</button>}{state.status === 'confirmation-required' && <button onClick={() => runAction(() => window.bookingAPI.confirmReservation())}>RECHECK RESERVATION</button>}</section>
    {notice && <p role="status">{notice}</p>}
    {state.timing?.releaseStartedAt && <p role="status">Release check started {state.timing.releaseDelayMs} ms after the scheduled time.{state.timing.submissionStartedAt && ` Reservation step started ${Date.parse(state.timing.submissionStartedAt) - Date.parse(state.timing.releaseStartedAt)} ms after that.`}</p>}
    <section className="grid">
      <form className="card" onSubmit={(event) => { event.preventDefault(); void arm() }}>
        <div className="form-head"><h2>Booking details</h2><button type="button" className="small" disabled={locked || scheduleLoading} onClick={() => void loadSchedule()}>{scheduleLoading ? 'LOADING…' : 'REFRESH SCHEDULE'}</button></div>
        <fieldset disabled={locked}>
        <p className="muted">{scheduleLoading ? 'Reading the live U of T badminton schedule…' : schedule && !schedule.loginRequired ? `Live U of T badminton schedule · updated ${DateTime.fromISO(schedule.loadedAt).toLocaleString(DateTime.TIME_SIMPLE)}` : 'Live U of T badminton schedule'}</p>
        {scheduleNotice && <p className="hint" role="status">{scheduleNotice}</p>}
        {days.length > 0 && <div className="dates" role="tablist" aria-label="Dates">{days.map((day) => {
          const date = DateTime.fromISO(day.date, { zone: TORONTO_ZONE })
          const armable = day.slots.filter((slot) => slotView(day, slot, courts).armable).length
          const mine = day.slots.filter((slot) => slot.courts.some((entry) => entry.status === 'booked')).map((slot) => shortTime(slot.label))
          return <button type="button" role="tab" key={day.date} aria-selected={day.date === activeDate} className={`date-card${day.date === activeDate ? ' active' : ''}`} onClick={() => setActiveDate(day.date)}>
            <span>{date.toFormat('ccc').toUpperCase()}</span><b>{date.toFormat('LLL d')}</b><small>{armable ? `${armable} to arm` : 'Nothing to arm'}</small>{mine.length > 0 && <em>Booked {mine.join(', ')}</em>}
          </button>
        })}</div>}
        {activeDay && (activeDay.slots.length ? <div className="slots">{activeDay.slots.map((slot) => {
          const view = slotView(activeDay, slot, courts)
          const isSelected = selected?.date === activeDay.date && selected.time === slot.time
          return <button type="button" key={slot.time} aria-pressed={isSelected} disabled={!view.armable} className={`slot-card${isSelected ? ' selected' : ''}${view.tone === 'mine' ? ' mine' : ''}`} onClick={() => setSelected({ date: activeDay.date, time: slot.time })}>
            <b>{slot.label}</b><span className={`slot-status ${view.tone}`}>{view.text}</span>
            <span className="chips">{COURTS.map((court) => { const entry = slot.courts.find((item) => item.court === court); return <i key={court} className={`chip ${entry?.status ?? 'unavailable'}${courts.includes(court) ? '' : ' off'}`} title={`${shortCourt(court)}: ${entry?.note ?? entry?.status ?? 'not listed'}`}>{court.slice(6, 8)}</i> })}</span>
          </button>
        })}</div> : <p className="muted">No slots left on this date.</p>)}
        <h3>Courts <small>Tried in order 1, 2, 3; moves to the next ticked court if one is Unavailable.</small></h3>
        <div className="court-checks">{COURTS.map((court) => <label key={court} className="check"><input type="checkbox" checked={chosen.includes(court)} onChange={(event) => setChosen((current) => event.target.checked ? [...current, court] : current.filter((item) => item !== court))} />{shortCourt(court)}</label>)}</div>
        <div className="release"><span>{selected ? `${DateTime.fromISO(selected.date).toFormat('cccc, LLL d')} · ${selectedSlot?.label ?? selected.time} · release (Toronto time)` : 'Release (Toronto time)'}</span><b>{releaseText}</b><small>Court refreshing starts 2 s before release.</small></div>
        </fieldset>
        <div className="actions"><button className="primary" disabled={locked || !request || !selectedArmable}>ARM BOOKING</button>{locked && !['reserving', 'confirming'].includes(state.status) && <button type="button" onClick={() => runAction(() => window.bookingAPI.cancelBooking())}>{state.status === 'confirmation-required' ? 'STOP CHECKING' : 'CANCEL'}</button>}</div>
      </form>
      <aside className="card"><h2>Result</h2>{state.result ? <><strong className="success">BOOKING CONFIRMED</strong><p>{state.result.court}</p><p>{state.result.date} · {state.result.time}</p><p>Confirmation: {state.result.confirmationNumber ?? 'Recorded by provider'}</p></> : <p>Booking confirmation appears here after provider verifies reservation.</p>}<h2>Safety</h2><p>CAPTCHA and MFA require your action in visible browser. App never stores credentials in UI or history.</p></aside>
    </section>
    <section className="grid lower">
      <section className="card how"><h2>How it works</h2><ol>
        <li><b>Pick a slot.</b> Choose a date, then a time card. Only slots you can still get can be picked; U of T allows one court booking per day.</li>
        <li><b>Tick courts.</b> They are tried in order: Court 01, 02, 03.</li>
        <li><b>Arm.</b> Sign in to U of T in the booking browser if asked, then keep this app open and the computer awake.</li>
        <li><b>{RELEASE_TIMING.preparationLeadMs / 60_000} min before release</b> (48 h before the slot starts), the booking browser loads the page and selects the date.</li>
        <li><b>From {RELEASE_TIMING.startBeforeReleaseMs / 1000} s before release</b>, it clicks the court tab to refresh the slots, a random {RELEASE_TIMING.minIntervalMs}–{RELEASE_TIMING.maxIntervalMs} ms apart, and clicks <b>Book</b> the instant the slot opens.</li>
        <li>If the slot shows <b>Unavailable</b> with no spots left, it moves to the next ticked court. It gives up {RELEASE_TIMING.stopAfterReleaseMs / 1000} s after release.</li>
        <li>The result appears above, and in Booking history once U of T confirms it.</li>
      </ol></section>
      <section className="card"><h2>Booking history</h2>{history.length ? <ul>{history.map((entry) => <li key={entry.id}><b>{entry.activity} · {entry.court}</b><br />{entry.date} {entry.time}<br /><small>{entry.confirmationNumber ?? 'Confirmed'}</small></li>)}</ul> : <p>No confirmed bookings yet.</p>}</section>
    </section>
  </main>
}
