# Booking timing and reliability

The requested outcome is a working automatic booking flow that starts at the
48-hour release instant with minimal local delay. Server acceptance depends on
network latency, availability, authentication and U of T. It cannot be guaranteed
to a particular millisecond.

Keep the existing provider and authenticated browser. Prepare before release,
use bounded wall-clock timers that recheck clock corrections, prevent automatic
system sleep while active, and record release/availability/submission/confirmation
timestamps. Reduce sequential browser reads and validate the exact selected
date, minute and court before submission. Refresh stale availability using the
court-number button at release, as explicitly requested by the user. Prepare
the date and court list in advance. Always click the preferred court at release,
including when already selected, and wait for its previous rows to be replaced.
Do not click the date on the prepared release path. Preserve full-page navigation
only for a requested date that has not yet entered the picker.

Alternatives considered: tuning only the timer leaves page loading as the main
delay; sending a hand-built reservation request risks mismatching the site's
current submission and verification flow. Prefer the existing site's Book action
with preparation and fewer browser round trips. Do not repeat an ambiguous
submission. Permit explicit confirmation rechecks without another Book click.

Verification must cover scheduler deadlines, slow/failed preparation,
cancellation, wall-clock changes, exact date/time/court matching, fallback courts,
session expiration, server confirmation correlation, and ambiguous submission.
Run a real-browser fixture through the actual scheduler and engine and measure
release dispatch and submission latency. Run lint, build and desktop persistence
checks. Verify the authenticated live schedule separately; fixture success is
not proof that a real reservation succeeded.

The user explicitly instructed: do not arm a real booking; work on the code.
All reservation tests therefore run against local browser fixtures. Do not arm
or submit a live reservation as part of this work.

## Verification evidence, September 22

- All 45 tests passed, including actual Chromium provider flows, exact court and
  start-minute matching, confirmation correlation, CAPTCHA handoff, cancellation,
  clock corrections and safe retries before submission.
- After strengthening the timing fixture to issue a real browser POST intercepted
  locally, that test passed: release callback +5 ms; reservation request +321 ms.
  These are observed local results, not a latency guarantee.
- Lint, TypeScript checking and production build passed. Desktop smoke passed
  startup, preload IPC, malformed request handling, settings save/application,
  persistence across restart and no renderer errors. Screenshot inspected.
- Authenticated live checks of September 24 at 19:00 and September 23 at 21:00
  passed preparation and correctly found no bookable matching slot. Preparation
  took 786/828 ms; availability took 483/580 ms respectively. No Book action ran.
- Live inspection discovered that AJAX replaces the court panel and removes its
  aria-labelledby. Fixed the provider and added the shared-panel regression test.
- Earlier inspection verified selected-date refresh. The user's subsequent
  instruction replaces that release action with the court-number click.
- App prevents automatic suspension while active; manual sleep, power loss and
  closing the app still stop timely execution.

## Limits that must not be represented as verified

No live reservation submission or real release-boundary server acceptance was
tested, per the user's instruction. Exact millisecond server acceptance is not
guaranteed by the local scheduler, operating system, network or external service.
Windows reported an unsynchronized clock; w32tm resync returned Access denied.
The local code does not correct an inaccurate system clock. Sync Windows time
before using the app for a live release.

## Court-click release verification

The requested court-click release action is implemented. The date and court list
are prepared in advance. Release clicks the first-priority court even if it is
already selected, waits for the old rows to be detached, and evaluates the new
schedule. Subsequent attempts and fallback courts also use court clicks.

All 46 tests, lint and production build passed. Regression tests verify the
release action is a court click with no date click/document reload, repeat clicks
on the same court, and rejection of stale pre-refresh available slots. In the
full test run, the real scheduler dispatched at +14 ms, the browser court click
occurred at +36 ms, and the locally intercepted reservation POST at +250 ms.
These measurements do not establish an exact-millisecond guarantee.

A read-only authenticated live check for September 24 at 07:00 observed exactly
three slot GET requests, for courts 3, 2 and 1 in that order, and no document
navigation during availability. The availability check took 142 ms and correctly
reported no bookable slot before release. No live reservation was armed or
submitted. The diagnostic browser was closed after verification.

## Browser-scheduled release verification

Preparation now installs the first court click inside Chromium at the computed
release deadline. It validates the selected date and court at that instant and
calls the court's native click handler. The main process consumes the refreshed
rows once; it does not click the court again for the first attempt. Later retries
still click the court. Cancellation disposes the browser timer; changing the date
prevents the scheduled click. A refresh timeout before any Book submission is
classified as a retryable network failure. Reservation submission remains under
the booking engine's cancellation and confirmation controls.

The final current-worktree run passed all 50 tests. Lint, TypeScript checking,
production build and desktop smoke also passed. The timed browser fixture
recorded court click +1 ms, main-process release processing +14 ms, and simulated
reservation POST +261 ms. Another test blocked the app thread across release:
Chromium still clicked at +1 ms while the app was unable to continue until more
than 300 ms after release. An earlier run observed +0 ms for the court click.
These measurements establish the absence of the main-process command delay;
they do not guarantee the browser/OS will always run within that interval.

The installed Playwright launch defaults include disabled background timer
throttling, disabled occluded-window backgrounding and disabled renderer
backgrounding. Readiness waits use timer polling rather than animation frames.

### Completion and blocked audit

The preceding goal turn was progress: it changed and verified the court-click
release action. This turn also made progress by independently scheduling that
click in the browser and verifying cancellation, a blocked app thread and a
stalled refresh. No live reservation was armed or submitted.

The literal whole-goal requirement of guaranteed exact-millisecond real booking
acceptance remains unproven. This same external verification limit persisted
through the three most recent goal turns. The user explicitly forbids arming a
live booking during this work; that instruction remains in force. Current Windows
time-service output also still reports not synchronized, and the earlier resync
attempt was denied for lack of administrator access. More repetitions of local
tests cannot prove external server acceptance or correct the OS time service.

The identified code changes and their authorized validation are complete. The
overall goal must not be marked achieved: further end-to-end proof needs a real
release opportunity and a changed user instruction permitting that validation.
Even then, a successful sample cannot prove an absolute timing guarantee.
