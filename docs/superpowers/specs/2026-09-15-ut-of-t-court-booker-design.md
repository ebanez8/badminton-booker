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

## U of T provider delivery boundary

Browser initialization, persistent-session lifecycle, and generic authentication workflow ship now. Date/time/court/reservation/confirmation selectors remain explicit provider TODOs until an authenticated page is inspected. Until then the provider returns actionable `PAGE_STRUCTURE_CHANGED` errors rather than guessing or reserving.

## Verification

Vitest covers pure court selection, release calculations including DST, validation, and state transitions. Type checking, linting, renderer build, Electron startup, persistence, secure IPC, ignored sensitive paths, and clean shutdown are verified locally. Provider live automation is verified only against the account page after manual login.
