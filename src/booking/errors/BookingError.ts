import type { BookingErrorCode, BookingFailure } from '../../shared/types'

const messages: Record<BookingErrorCode, string> = {
  AUTHENTICATION_REQUIRED: 'Login required. Complete U of T authentication in browser.',
  CAPTCHA_REQUIRED: 'User action required. Complete authentication in browser.',
  SESSION_EXPIRED: 'Session expired. Complete U of T authentication in browser.',
  BOOKING_NOT_OPEN: 'Booking is not open yet.', COURT_UNAVAILABLE: 'Selected court is unavailable.',
  NO_AVAILABLE_COURTS: 'No acceptable courts are currently available.',
  NETWORK_ERROR: 'Temporary network problem. Booking attempt failed after configured retries.',
  PAGE_STRUCTURE_CHANGED: 'Booking website structure may have changed. Review U of T provider selectors.',
  BOOKING_CONFIRMATION_FAILED: 'Reservation could not be confirmed.', BOOKING_CANCELLED: 'Booking cancelled.',
  VALIDATION_ERROR: 'Booking details are invalid.', UNKNOWN_ERROR: 'Booking failed unexpectedly.'
}

export class BookingError extends Error {
  constructor(public readonly code: BookingErrorCode, technicalMessage?: string) {
    super(technicalMessage ?? messages[code])
    this.name = 'BookingError'
  }
  toFailure(): BookingFailure { return { code: this.code, userMessage: messages[this.code], technicalMessage: this.message } }
}

