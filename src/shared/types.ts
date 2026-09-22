export const BOOKING_STATUSES = [
  'idle', 'initializing', 'checking-authentication', 'login-required', 'preparing', 'armed',
  'waiting-for-release', 'checking-availability', 'selecting-court', 'confirmation-required', 'reserving', 'confirming',
  'confirmed', 'failed', 'cancelled'
] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]
export type BookingErrorCode =
  | 'AUTHENTICATION_REQUIRED' | 'CAPTCHA_REQUIRED' | 'SESSION_EXPIRED' | 'BOOKING_NOT_OPEN'
  | 'COURT_UNAVAILABLE' | 'NO_AVAILABLE_COURTS' | 'NETWORK_ERROR' | 'PAGE_STRUCTURE_CHANGED'
  | 'BOOKING_CONFIRMATION_FAILED' | 'BOOKING_CANCELLED' | 'VALIDATION_ERROR' | 'UNKNOWN_ERROR'

export interface ReleaseRule {
  mode: 'offset-hours' | 'exact-date-time'
  offsetHours?: number
  dateTime?: string
}

export interface BookingRequest {
  activity: string
  date: string
  time: string
  courtPreferences: string[]
  allowAnyCourt: boolean
  releaseRule: ReleaseRule
}

export interface CourtAvailability { id: string; name: string; available: boolean }
export interface BookingResult {
  success: boolean
  court?: string
  date?: string
  time?: string
  confirmationNumber?: string
  message: string
}
export interface BookingFailure { code: BookingErrorCode; userMessage: string; technicalMessage?: string }
export interface BookingTiming {
  releaseStartedAt?: string
  releaseDelayMs?: number
  availabilityCompletedAt?: string
  submissionStartedAt?: string
  confirmedAt?: string
}
export interface BookingState {
  status: BookingStatus
  message: string
  request?: BookingRequest
  releaseDateTime?: string
  result?: BookingResult
  error?: BookingFailure
  timing?: BookingTiming
  updatedAt: string
}
export interface AppSettings {
  bookingUrl: string
  defaultActivity: string
  defaultReleaseOffsetHours: number
  maxRetries: number
  retryDelayMs: number
  showBrowser: boolean
  headlessWhenAuthenticated: boolean
  allowAnyCourt: boolean
  defaultCourtOrder: string[]
}
export interface BookingHistoryEntry extends BookingResult {
  id: string
  activity: string
  bookedAt: string
  status: 'confirmed'
}
export interface BookingApi {
  getState(): Promise<BookingState>
  armBooking(request: BookingRequest): Promise<BookingState>
  confirmReservation(): Promise<BookingState>
  cancelBooking(): Promise<BookingState>
  openLogin(): Promise<void>
  getSettings(): Promise<AppSettings>
  saveSettings(settings: AppSettings): Promise<AppSettings>
  getHistory(): Promise<BookingHistoryEntry[]>
  onStateChange(listener: (state: BookingState) => void): () => void
}
