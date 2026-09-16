# U of T 48-hour release and date selection

## Decision

U of T Badminton bookings release exactly 48 elapsed hours before the requested
Toronto-local start time.  The scheduler calculates that instant by subtracting
48 hours from the requested datetime (including through DST), prepares the
authenticated page before it, and makes the availability/reservation request
immediately when its release timer fires.

## Date picker

The site exposes booking dates as buttons, not a native date input.  The
provider selects the requested date with its `data-year`, `data-month`, and
`data-day` values (`data-month` is one-based), and only proceeds after that
same button has `aria-current="date"`.  A date absent from the two-calendar-day
picker is an explicit page-structure/availability failure; it is never
silently replaced by the visible default date.

## Booking execution

After availability selects the preferred court, the engine submits that court
in the scheduled release path without a second confirmation delay.  It still
requires explicit site confirmation after the click and preserves manual
CAPTCHA/login handoff.

## Verification

Tests cover the fixed 48-hour U of T rule and the selector construction used
for the date-button markup.  Type checking, linting, and the test suite must
pass before a manual authenticated pass-through is attempted.
