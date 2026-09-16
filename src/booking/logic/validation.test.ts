import { describe, expect, it } from 'vitest'
import { validateBookingRequest } from './validation'
import type { BookingRequest } from '../../shared/types'

const valid: BookingRequest = { activity: 'Badminton', date: '2099-09-20', time: '19:00', courtPreferences: ['Court 3'], allowAnyCourt: false, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
describe('validateBookingRequest', () => {
  it('accepts valid future request', () => expect(validateBookingRequest(valid)).toEqual([]))
  it('rejects no acceptable court', () => expect(validateBookingRequest({ ...valid, courtPreferences: [] })).toContain('Choose a court or enable any available court.'))
})
