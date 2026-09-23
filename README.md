# U of T Court Booker

Windows Electron app for one future U of T badminton booking.

## Run

```powershell
npm install
npx playwright install chromium
npm run dev
```

For a built version, run `npm run build` then `npm start`.

The app reads the live U of T schedule when it opens (and on **Refresh schedule**)
and shows it as a calendar: one card per date U of T lists, then one card per time
slot. Pick a slot card to lock in its date and time. Slots that are full, already
started, or on a day you have already booked cannot be picked; U of T allows one
court booking per day. Tick the courts to try (Court 01, 02, 03, tried in that
order), then choose **Arm booking**. If release has already passed, it checks
immediately after preparation. Keep the app running and the computer powered on;
bookings are not scheduled while the app is closed.
The app prevents automatic system sleep while a booking is active. This does not
override manual sleep, a closed laptop lid, loss of power, or an OS restart.

If sign-in is required, finish it in the booking browser, then choose **Recheck
login & arm**. MFA and CAPTCHA remain manual. Authentication uses the private
local Chromium profile, with session restoration enabled. U of T may still
expire a session independently.

Slots as U of T shows them: **Book Now** is open; **Opens at 9 PM**, or
**Unavailable** that still lists "1 spot available", has not opened yet;
**Unavailable** with "No spots available" is taken; **Booked** is yours.

Preparation starts two minutes before release and selects the requested date.
From two seconds before release (7:59:58.000 for an 8 PM slot), a loop inside
Chromium clicks the first ticked court's tab, which refreshes its slots, reads the
requested slot, and clicks **Book** the moment it opens. Clicks start a random
20–50 ms apart. If the slot is taken, the loop moves to the next ticked court; it
stops 30 s after release. Running the loop inside Chromium keeps the desktop app
process out of the release-critical path. Cancellation stops the loop. An uncertain Book
submission is never automatically repeated. Complete any browser verification
and choose **Recheck reservation**. **Stop checking** stops verification only;
it does not cancel a reservation on U of T.

The browser is always shown before booking so any verification can be completed.
The app reports when the main process starts checking release results and how
long it took to reach the reservation step. The browser's scheduled court click
can occur before that main-process check. Logs use UTC timestamps with milliseconds. These measure
local dispatch, not server acceptance. Keep Windows **Time & language > Date &
time > Sync now** synchronized: network latency, OS scheduling and the server
prevent a guarantee of acceptance at an exact millisecond. The scheduler adapts
to wall-clock corrections and never intentionally starts before release.

Settings take effect when saved. Settings cannot be changed during a booking.
Settings, browser state, logs, and successful booking history live under
`%APPDATA%/ut-of-t-court-booker`, outside the repository.

## Verification

```powershell
npm test
npm run lint
npm run build
node scripts/smoke-desktop.mjs
```

The browser tests use local fixtures based on inspected U of T markup; they
never contact U of T or make real bookings. The desktop smoke test uses isolated
data under `out/diagnostics` and checks startup, IPC, validation, settings, and
persistence across restart.

To check the actual provider without submitting a reservation, close the app
and run:

```powershell
node scripts/verify-live.mjs "$env:APPDATA/ut-of-t-court-booker"
```

Sign in if prompted. Enter `check YYYY-MM-DD HH:mm` to exercise authentication,
preparation, date selection, and court availability. `inspect` reports the visible
schedule; `refresh` checks the site's selected-date refresh; `quit` closes the diagnostic browser. The diagnostic has no reservation
submission command. A real successful booking still requires an available slot
and an explicit confirmation from U of T.
