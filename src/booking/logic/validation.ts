import type { BookingRequest } from '../../shared/types'
import { DateTime } from 'luxon'
import { calculateReleaseDateTime, desiredDateTime } from './releaseTime'

export function validateBookingRequest(request: BookingRequest): string[] {
  const errors: string[] = []
  if (!request || typeof request.activity !== 'string' || typeof request.date !== 'string' || typeof request.time !== 'string' ||
      !Array.isArray(request.courtPreferences) || !request.courtPreferences.every((court) => typeof court === 'string') ||
      typeof request.allowAnyCourt !== 'boolean' || !request.releaseRule) return ['Enter valid booking details.']
  if (!request.activity.trim()) errors.push('Activity is required.')
  else if (request.activity !== 'Badminton') errors.push('This provider supports Badminton only.')
  if (!request.courtPreferences.length && !request.allowAnyCourt) errors.push('Choose a court or enable any available court.')
  if (request.courtPreferences.some((court) => !/^Court 0[123]-AC-Badminton$/.test(court))) errors.push('Use Court 01-AC-Badminton, Court 02-AC-Badminton, or Court 03-AC-Badminton.')
  try {
    const desired = desiredDateTime(request)
    if (desired <= DateTime.now().setZone(desired.zoneName)) errors.push('Desired booking time must be in future.')
    if (request.releaseRule.mode !== 'offset-hours' || request.releaseRule.offsetHours !== 48) {
      errors.push('U of T badminton bookings release exactly 48 hours before the requested start time.')
    } else if (calculateReleaseDateTime(request) >= desired) errors.push('Release must be before desired booking.')
  } catch { errors.push('Enter valid Toronto date, time, and release rule.') }
  return errors
}
