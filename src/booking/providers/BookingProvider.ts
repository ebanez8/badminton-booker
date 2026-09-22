import type { BookingRequest, BookingResult, CourtAvailability } from '../../shared/types'

export interface BookingProvider {
  initialize(): Promise<void>
  isAuthenticated(): Promise<boolean>
  requestAuthentication(): Promise<void>
  prepare(request: BookingRequest, releaseAtMs?: number): Promise<void>
  getAvailability(request: BookingRequest): Promise<CourtAvailability[]>
  reserve(request: BookingRequest, court: CourtAvailability): Promise<BookingResult>
  confirmReservation(request: BookingRequest, court: CourtAvailability): Promise<BookingResult>
  close(): Promise<void>
}
