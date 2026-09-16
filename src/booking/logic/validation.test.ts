import { describe, expect, it } from 'vitest'
import { validateBookingRequest } from './validation'
import type { BookingRequest } from '../../shared/types'

const valid: BookingRequest = { activity: 'Badminton', date: '2099-09-20', time: '19:00', courtPreferences: ['Court 3'], allowAnyCourt: false, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
describe('validateBookingRequest', () => {
  it('accepts valid future request', () => expect(validateBookingRequest(valid)).toEqual([]))
  it('rejects no acceptable court', () => expect(validateBookingRequest({ ...valid, courtPreferences: [] })).toContain('Choose a court or enable any available court.'))
  it('requires the U of T exact 48-hour release rule', () => {
    expect(validateBookingRequest({ ...valid, releaseRule: { mode: 'offset-hours', offsetHours: 47 } })).toContain('U of T badminton bookings release exactly 48 hours before the requested start time.')
    expect(validateBookingRequest({ ...valid, releaseRule: { mode: 'exact-date-time', dateTime: '2099-09-18T19:00:00-04:00' } })).toContain('U of T badminton bookings release exactly 48 hours before the requested start time.')
  })
})
