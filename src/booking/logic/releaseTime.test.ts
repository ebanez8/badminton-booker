import { describe, expect, it } from 'vitest'
import { calculateReleaseDateTime } from './releaseTime'
import type { BookingRequest } from '../../shared/types'

const request = (date: string, time: string, hours: number): BookingRequest => ({
  activity: 'Badminton', date, time, courtPreferences: ['Court 3'], allowAnyCourt: true,
  releaseRule: { mode: 'offset-hours', offsetHours: hours }
})

describe('calculateReleaseDateTime', () => {
  it('subtracts offset across midnight in Toronto', () => {
    expect(calculateReleaseDateTime(request('2026-09-20', '00:30', 48)).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-18 00:30')
  })
  it('uses elapsed hours through DST', () => {
    expect(calculateReleaseDateTime(request('2026-03-08', '03:30', 24)).toUTC().toISO()).toBe('2026-03-07T07:30:00.000Z')
  })
  it('accepts exact release times', () => {
    const exact = { ...request('2026-09-20', '19:00', 48), releaseRule: { mode: 'exact-date-time' as const, dateTime: '2026-09-18T19:00:00-04:00' } }
    expect(calculateReleaseDateTime(exact).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-09-18 19:00')
  })
})
