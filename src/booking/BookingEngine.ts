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
  private pendingReservation?: { request: BookingRequest; court: CourtAvailability }
  private listeners = new Set<(state: BookingState) => void>()
  constructor(private readonly provider: BookingProvider, private readonly scheduler: BookingScheduler, private readonly options: { maxRetries: number; retryDelayMs: number; saveHistory(entry: BookingHistoryEntry): Promise<void>; logger: BookingLogger }) {}
  getState(): BookingState { return this.state }
  subscribe(listener: (state: BookingState) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  async arm(request: BookingRequest): Promise<BookingState> {
    const errors = validateBookingRequest(request)
    if (errors.length) return this.setState('failed', errors[0], { error: new BookingError('VALIDATION_ERROR', errors.join(' ')).toFailure() })
    try {
      this.setState('initializing', 'Initializing browser...', { request, error: undefined, result: undefined })
      await this.provider.initialize()
      this.setState('checking-authentication', 'Checking account...', { request })
      if (!(await this.provider.isAuthenticated())) {
        await this.provider.requestAuthentication()
        return this.setState('login-required', 'Login required. Complete U of T authentication in browser.', { request, error: new BookingError('AUTHENTICATION_REQUIRED').toFailure() })
      }
      const release = calculateReleaseDateTime(request)
      this.setState('armed', 'Booking armed.', { request, releaseDateTime: release.toISO() ?? undefined })
      this.scheduler.arm(release.toMillis(), {
        prepare: async () => { this.setState('preparing', 'Preparing booking page...'); await this.provider.prepare(request) },
        waiting: () => this.setState('waiting-for-release', 'Waiting for booking release...'),
        release: async () => this.attemptBooking(request)
      })
    } catch (error) { this.fail(error) }
    return this.state
  }
  cancel(): BookingState { this.scheduler.cancel(); return this.setState('cancelled', 'Booking cancelled.') }
  async confirmReservation(): Promise<BookingState> {
    const pending = this.pendingReservation
    if (!pending) return this.state
    this.pendingReservation = undefined
    await this.reserve(pending.request, pending.court)
    return this.state
  }
  async close(): Promise<void> { this.scheduler.cancel(); await this.provider.close() }
  private async attemptBooking(request: BookingRequest): Promise<void> {
    try {
      this.setState('checking-availability', 'Checking availability...')
      const courts = await this.withRetries(() => this.provider.getAvailability(request))
      this.setState('selecting-court', 'Selecting highest-priority court...')
      const court = chooseCourt(courts, request.courtPreferences, request.allowAnyCourt)
      if (!court) throw new BookingError('NO_AVAILABLE_COURTS')
      this.pendingReservation = { request, court }
      this.setState('confirmation-required', `${court.name} is available. Confirm to click Book.`)
    } catch (error) { this.fail(error) }
  }
  private async reserve(request: BookingRequest, court: CourtAvailability): Promise<void> {
    try {
      this.setState('reserving', `Reserving ${court.name}...`)
      const result = await this.withRetries(() => this.provider.reserve(request, court))
      if (!result.success) throw new BookingError('BOOKING_CONFIRMATION_FAILED', result.message)
      this.setState('confirming', 'Confirming reservation...')
      const entry: BookingHistoryEntry = { ...result, id: crypto.randomUUID(), activity: request.activity, bookedAt: new Date().toISOString(), status: 'confirmed' }
      await this.options.saveHistory(entry)
      this.setState('confirmed', 'BOOKING CONFIRMED', { result })
    } catch (error) { this.fail(error) }
  }
  private async withRetries<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try { return await action() } catch (error) { lastError = error; if (attempt + 1 < this.options.maxRetries) await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs)) }
    }
    throw lastError
  }
  private fail(error: unknown): BookingState { const bookingError = error instanceof BookingError ? error : new BookingError('UNKNOWN_ERROR'); return this.setState('failed', bookingError.toFailure().userMessage, { error: bookingError.toFailure() }) }
  private setState(status: BookingStatus, message: string, patch: Partial<BookingState> = {}): BookingState {
    this.state = { ...this.state, ...patch, status, message, updatedAt: new Date().toISOString() }
    void this.options.logger.info(message)
    for (const listener of this.listeners) listener(this.state)
    return this.state
  }
}
