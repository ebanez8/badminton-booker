# U of T Court Booker

Windows Electron app for one future U of T badminton booking.

## Run

```powershell
npm install
npx playwright install chromium
npm run dev
```

For a built version, run `npm run build` then `npm start`.

Choose the Toronto date and the **exact start time shown by U of T**, including
minutes (for example, 9:10 PM). Set the court order, then choose **Arm booking**.
The app starts its booking attempt at the 48-hour release instant. If release has
already passed, it checks immediately after preparation. Keep the app running
and the computer powered on; bookings are not scheduled while the app is closed.
The app prevents automatic system sleep while a booking is active. This does not
override manual sleep, a closed laptop lid, loss of power, or an OS restart.

If sign-in is required, finish it in the booking browser, then choose **Recheck
login & arm**. MFA and CAPTCHA remain manual. Authentication uses the private
local Chromium profile, with session restoration enabled. U of T may still
expire a session independently.

Preparation starts two minutes before release and selects the requested date.
At release, the app clicks the first-priority **court number**, even when that
court is already selected. When preparation finishes ahead of release, this
click is scheduled inside Chromium so a busy desktop app process cannot delay
sending the click command. Cancellation clears the scheduled click. That click refreshes the court's slots; the normal
release path does not click the date or reload the page. It reloads the full page
only if the requested date has not entered the date picker yet. It reads each court's schedule in one browser
round trip. The app waits for the selected date's refreshed schedule and visits courts in
priority order. Availability checks have bounded retries. An uncertain Book
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
