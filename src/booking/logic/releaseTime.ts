import { DateTime } from 'luxon'
import type { BookingRequest } from '../../shared/types'
import { BookingError } from '../errors/BookingError'

export const TORONTO_ZONE = 'America/Toronto'

export function desiredDateTime(request: BookingRequest): DateTime {
  const value = DateTime.fromFormat(`${request.date} ${request.time}`, 'yyyy-MM-dd HH:mm', { zone: TORONTO_ZONE })
  if (!value.isValid || value.toFormat('yyyy-MM-dd HH:mm') !== `${request.date} ${request.time}`) throw new BookingError('VALIDATION_ERROR', 'Invalid Toronto booking date/time')
  return value
}

export function calculateReleaseDateTime(request: BookingRequest): DateTime {
  if (request.releaseRule.mode === 'exact-date-time') {
    const exact = DateTime.fromISO(request.releaseRule.dateTime ?? '', { zone: TORONTO_ZONE, setZone: true }).setZone(TORONTO_ZONE)
    if (!exact.isValid) throw new BookingError('VALIDATION_ERROR', 'Invalid exact release time')
    return exact
  }
  const hours = request.releaseRule.offsetHours
  if (!Number.isFinite(hours) || hours === undefined || hours < 0) throw new BookingError('VALIDATION_ERROR', 'Release offset must be zero or greater')
  return desiredDateTime(request).minus({ hours })
}
