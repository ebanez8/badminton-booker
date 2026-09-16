# U of T Court Booker design

## Scope

Windows-first Electron desktop app for one configurable future badminton booking. Build all reusable, testable application infrastructure now. Implement U of T page selectors only after inspecting an authenticated DOM; no invented selectors.

## Boundaries

`React renderer -> preload contextBridge -> Electron IPC -> BookingEngine -> BookingScheduler -> BookingProvider -> BrowserManager/Playwright`.

The renderer owns form state and displays status/history. It cannot access Node.js, credentials, Playwright, or arbitrary IPC. The Electron main process owns booking state, timing, data, and browser lifecycle. `BookingProvider` hides site-specific automation; `UofTBookingProvider` is its first implementation.

## Data and timing

Shared discriminated/union types describe requests, status, errors, availability, results, settings, and history. A booking uses an IANA `America/Toronto` local date/time. Release rules support configurable offset hours and an exact release date/time. Luxon performs zone-aware calculations.

The scheduler starts browser/page preparation before release, sets a single release timer, performs bounded configurable retries, and supports cancellation/clean shutdown. It never busy-waits or rapidly polls.

## Authentication and browser

Playwright launches a persistent Chromium profile under Electron user data, never in Git. Browser is visible by default. Authentication uses multiple authenticated-page signals supplied by the provider; URL alone is insufficient. If interactive login, MFA, or CAPTCHA is needed, the app opens visible browser and pauses for user action. No CAPTCHA/MFA/access-control bypass, credential logging, or token/cookie exposure.

## Storage, UI, and errors

Non-sensitive settings and successful history use JSON in Electron user data. History contains booking metadata and confirmation details only. Strongly typed status/error codes map to friendly UI messages; technical details go to redacted local logs. Success requires provider confirmation evidence, never a clicked button alone.

## U of T provider delivery

The authenticated S&R Badminton page exposes a "Select Date & Time" availability grid with three court columns: `Court 01-AC-Badminton`, `Court 02-AC-Badminton`, and `Court 03-AC-Badminton`. Each time row reports availability and, when eligible, presents a `Book` control. The provider will use scoped, semantic locators (court label, time-row text, availability text, and the row's `Book` button), rather than page-wide positional or CSS selectors.

At the scheduled release instant, the provider refreshes the page, resolves the configured Toronto-local date and time row, and attempts the requested court priority in order. If `allowAnyCourt` is set, it may use another court in the same row only after the priority choices have no available `Book` control. After clicking `Book`, it waits for an explicit successful booked state; a click alone is never confirmation.

CAPTCHA is a manual handoff: the visible browser stays open, the scheduler changes to a login/action-required state, and the user completes it. If the site displays an error, unavailable state, timeout, unexpected dialog, or no booked confirmation, the provider records redacted diagnostic evidence (URL, visible status text, selected court/time, and screenshot path) and exposes a friendly, actionable failure message in the app. It never log credentials, cookies, CAPTCHA content, or access tokens.

For the initial live test, the configured release is Thursday at 10:00 PM America/Toronto for a Saturday 10:00 PM slot, satisfying the two-day booking rule. The final external `Book` submission requires immediate user confirmation at runtime.

## Verification

Vitest covers pure court selection, release calculations including DST, validation, and state transitions. Type checking, linting, renderer build, Electron startup, persistence, secure IPC, ignored sensitive paths, and clean shutdown are verified locally. Provider live automation is verified only against the account page after manual login.
