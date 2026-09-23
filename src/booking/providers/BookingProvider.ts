import type { BookingRequest, BookingResult, CourtAvailability, ScheduleDay } from '../../shared/types'

export interface ReleaseClick { court: CourtAvailability; clickedAt: number; refreshes: number }

export interface BookingProvider {
  initialize(): Promise<void>
  isAuthenticated(): Promise<boolean>
  requestAuthentication(): Promise<void>
  prepare(request: BookingRequest, releaseAtMs?: number): Promise<void>
  getAvailability(request: BookingRequest): Promise<CourtAvailability[]>
  /** Every date in the site's picker with each court's slots. Requires an authenticated page. */
  getSchedule?(): Promise<ScheduleDay[]>
  /** Waits for the prepared in-page release loop to click Book. Undefined when no loop is running. */
  waitForReleaseClick?(request: BookingRequest): Promise<ReleaseClick | undefined>
  reserve(request: BookingRequest, court: CourtAvailability): Promise<BookingResult>
  confirmReservation(request: BookingRequest, court: CourtAvailability): Promise<BookingResult>
  close(): Promise<void>
}
