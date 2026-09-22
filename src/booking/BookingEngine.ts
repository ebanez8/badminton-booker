import type { BookingHistoryEntry, BookingRequest, BookingState, BookingStatus, CourtAvailability } from '../shared/types'
import type { BookingProvider } from './providers/BookingProvider'
import { BookingError } from './errors/BookingError'
import { chooseCourt } from './logic/chooseCourt'
import { calculateReleaseDateTime } from './logic/releaseTime'
import { validateBookingRequest } from './logic/validation'
import { BookingScheduler } from './BookingScheduler'
interface BookingLogger { info(message: string): Promise<void> }

export class BookingEngine {
  private state: BookingState = { status: 'idle', message: 'Ready to configure booking.', updatedAt: new Date().toISOString() }
  private listeners = new Set<(state: BookingState) => void>()
  private generation = 0
  private stopping?: Promise<void>
  private pendingReservation?: { request: BookingRequest; court: CourtAvailability }
  constructor(private readonly provider: BookingProvider, private readonly scheduler: BookingScheduler, private readonly options: { maxRetries: number; retryDelayMs: number; saveHistory(entry: BookingHistoryEntry): Promise<void>; logger: BookingLogger }) {}
  getState(): BookingState { return this.state }
  subscribe(listener: (state: BookingState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async arm(request: BookingRequest): Promise<BookingState> {
    if (!['idle', 'failed', 'cancelled', 'confirmed', 'login-required'].includes(this.state.status)) return this.state
    this.scheduler.cancel()
    const generation = ++this.generation
    this.pendingReservation = undefined
    const errors = validateBookingRequest(request)
    if (errors.length) return this.setState('failed', errors[0], { request, result: undefined, releaseDateTime: undefined, error: new BookingError('VALIDATION_ERROR', errors.join(' ')).toFailure() })
    try {
      this.setState('initializing', 'Initializing browser...', { request, error: undefined, result: undefined, releaseDateTime: undefined, timing: undefined })
      if (this.stopping) await this.stopping
      if (generation !== this.generation) return this.state
      await this.provider.initialize()
      if (generation !== this.generation) return this.state
      this.setState('checking-authentication', 'Checking account...', { request })
      const authenticated = await this.provider.isAuthenticated()
      if (generation !== this.generation) return this.state
      if (!authenticated) {
        await this.provider.requestAuthentication()
        if (generation !== this.generation) return this.state
        return this.setState('login-required', 'Login required. Complete U of T authentication in browser.', { request, error: new BookingError('AUTHENTICATION_REQUIRED').toFailure() })
      }
      const release = calculateReleaseDateTime(request)
      const releaseAtMs = release.toMillis()
      this.setState('armed', 'Booking armed.', { request, releaseDateTime: release.toISO() ?? undefined })
      this.scheduler.arm(releaseAtMs, {
        prepare: async () => { this.setState('preparing', 'Preparing booking page...'); await this.provider.prepare(request, releaseAtMs) },
        waiting: () => this.setState('waiting-for-release', 'Waiting for booking release...'),
        release: async () => this.attemptBooking(request, generation, releaseAtMs),
        error: (error) => { if (generation === this.generation) this.fail(error) }
      })
    } catch (error) { if (generation === this.generation) this.fail(error) }
    return this.state
  }
  cancel(): BookingState {
    if (['reserving', 'confirming'].includes(this.state.status)) return this.state
    const uncertain = this.state.status === 'confirmation-required'
    this.generation += 1
    this.scheduler.cancel()
    this.pendingReservation = undefined
    if (!uncertain) this.stopping = this.provider.close().catch(() => undefined)
    return this.setState('cancelled', uncertain ? 'Stopped checking. This does not cancel a reservation on U of T. Verify your bookings there before trying again.' : 'Booking cancelled.')
  }
  async confirmReservation(): Promise<BookingState> {
    if (this.state.status !== 'confirmation-required' || !this.pendingReservation) return this.state
    const { request, court } = this.pendingReservation
    await this.reserve(request, court, true)
    return this.state
  }
  async close(): Promise<void> { this.generation += 1; this.scheduler.cancel(); await this.provider.close() }
  private async attemptBooking(request: BookingRequest, generation: number, releaseAtMs: number): Promise<void> {
    if (generation !== this.generation) return
    try {
      const started = Date.now()
      const releaseDelayMs = started - releaseAtMs
      this.setState('checking-availability', 'Checking availability...', { timing: { releaseStartedAt: new Date(started).toISOString(), releaseDelayMs } })
      void this.options.logger.info(`Release check started ${releaseDelayMs} ms after scheduled release.`).catch(() => undefined)
      await this.withRetries(async () => {
        const courts = await this.provider.getAvailability(request)
        if (generation !== this.generation) throw new BookingError('BOOKING_CANCELLED')
        const selected = chooseCourt(courts, request.courtPreferences, request.allowAnyCourt)
        if (!selected) throw new BookingError('NO_AVAILABLE_COURTS')
        this.setState('selecting-court', 'Selecting highest-priority court...', { timing: { ...this.state.timing, availabilityCompletedAt: new Date().toISOString() } })
        await this.reserve(request, selected)
      }, generation)
    } catch (error) { if (generation === this.generation) this.fail(error) }
  }
  private async reserve(request: BookingRequest, court: CourtAvailability, verifyOnly = false): Promise<void> {
    try {
      this.pendingReservation = { request, court }
      this.setState(verifyOnly ? 'confirming' : 'reserving', verifyOnly ? 'Rechecking reservation...' : `Reserving ${court.name}...`, {
        error: undefined, timing: verifyOnly ? this.state.timing : { ...this.state.timing, submissionStartedAt: new Date().toISOString() }
      })
      // A timeout after submission is ambiguous: never blindly click Book twice.
      const result = verifyOnly ? await this.provider.confirmReservation(request, court) : await this.provider.reserve(request, court)
      if (!result.success) throw new BookingError('BOOKING_CONFIRMATION_FAILED', result.message)
      this.setState('confirming', 'Confirming reservation...')
      const entry: BookingHistoryEntry = { ...result, id: crypto.randomUUID(), activity: request.activity, bookedAt: new Date().toISOString(), status: 'confirmed' }
      let historySaved = true
      try { await this.options.saveHistory(entry) } catch { historySaved = false }
      this.pendingReservation = undefined
      this.setState('confirmed', historySaved ? 'BOOKING CONFIRMED' : 'BOOKING CONFIRMED. Could not save local history; keep the confirmation in the booking browser.', { result, timing: { ...this.state.timing, confirmedAt: new Date().toISOString() } })
    } catch (error) {
      const failure = error instanceof BookingError ? error : new BookingError('BOOKING_CONFIRMATION_FAILED', error instanceof Error ? error.message : 'Unknown reservation error')
      // These provider errors are raised only before the Book click. Refresh
      // availability and choose again if a court disappeared in that interval.
      if (!verifyOnly && ['COURT_UNAVAILABLE', 'BOOKING_NOT_OPEN'].includes(failure.code)) {
        this.pendingReservation = undefined
        this.setState('checking-availability', 'Court changed before submission. Checking availability again...')
        throw failure
      }
      if (['CAPTCHA_REQUIRED', 'BOOKING_CONFIRMATION_FAILED'].includes(failure.code)) {
        this.setState('confirmation-required', 'Check the booking browser, complete any verification, then recheck the reservation. Book will not be clicked again.', { error: failure.toFailure() })
      } else this.fail(failure)
    }
  }
  private async withRetries<T>(action: () => Promise<T>, generation: number): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      if (generation !== this.generation) throw new BookingError('BOOKING_CANCELLED')
      try { return await action() } catch (error) {
        lastError = error
        if (!(error instanceof BookingError) || !['NETWORK_ERROR', 'BOOKING_NOT_OPEN', 'NO_AVAILABLE_COURTS', 'COURT_UNAVAILABLE'].includes(error.code)) throw error
        if (attempt + 1 < this.options.maxRetries) await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs))
      }
    }
    throw lastError
  }
  private fail(error: unknown): BookingState {
    this.scheduler.cancel()
    const bookingError = error instanceof BookingError ? error : new BookingError('UNKNOWN_ERROR', error instanceof Error ? error.message : String(error))
    const status = ['AUTHENTICATION_REQUIRED', 'SESSION_EXPIRED', 'CAPTCHA_REQUIRED'].includes(bookingError.code) ? 'login-required' : 'failed'
    return this.setState(status, bookingError.toFailure().userMessage, { error: bookingError.toFailure() })
  }
  private setState(status: BookingStatus, message: string, patch: Partial<BookingState> = {}): BookingState {
    this.state = { ...this.state, ...patch, status, message, updatedAt: new Date().toISOString() }
    void this.options.logger.info(message).catch(() => { /* A log write must not break booking state. */ })
    for (const listener of this.listeners) listener(this.state)
    return this.state
  }
}
