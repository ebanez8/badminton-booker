import type { BookingRequest } from '../../shared/types'
import { DateTime } from 'luxon'
import { calculateReleaseDateTime, desiredDateTime } from './releaseTime'

export function validateBookingRequest(request: BookingRequest): string[] {
  const errors: string[] = []
  if (!request.activity.trim()) errors.push('Activity is required.')
  if (!request.courtPreferences.length && !request.allowAnyCourt) errors.push('Choose a court or enable any available court.')
  try {
    const desired = desiredDateTime(request)
    if (desired <= DateTime.now().setZone(desired.zoneName)) errors.push('Desired booking time must be in future.')
    if (calculateReleaseDateTime(request) >= desired) errors.push('Release must be before desired booking.')
  } catch { errors.push('Enter valid Toronto date, time, and release rule.') }
  return errors
}
