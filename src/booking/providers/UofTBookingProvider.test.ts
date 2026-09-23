import { describe, expect, it } from 'vitest'
import { uOfTDateButtonSelector, uOfTStartTime, uOfTTimeMatches } from './UofTBookingProvider'

describe('uOfTDateButtonSelector', () => {
  it('uses the one-based date attributes exposed by the U of T date picker', () => {
    expect(uOfTDateButtonSelector('2026-09-17')).toBe('button.single-date-select-button[data-year="2026"][data-month="9"][data-day="17"]')
  })

  it('rejects invalid ISO dates', () => {
    expect(() => uOfTDateButtonSelector('Sep 17, 2026')).toThrow('Invalid booking date')
    expect(() => uOfTDateButtonSelector('2026-02-30')).toThrow('Invalid booking date')
  })
})

describe('U of T slot times', () => {
  it.each([
    ['9:10 - 9:55 PM', '21:10'], ['10 - 10:50 PM', '22:00'],
    ['7 - 8 PM', '19:00'], ['7:30 - 8:20 PM', '19:30'],
    ['11:30 AM - 12:20 PM', '11:30'], ['11 - 12 PM', '11:00'],
    ['12 - 12:50 PM', '12:00'], ['11:30 - 12:20 AM', '23:30']
  ])('matches %s to %s', (label, time) => expect(uOfTTimeMatches(label, time)).toBe(true))
  it('reads the 24-hour start time used by the calendar', () => {
    expect(uOfTStartTime('9 - 9:55 PM')).toBe('21:00')
    expect(uOfTStartTime('10 - 10:50 PM')).toBe('22:00')
    expect(uOfTStartTime('7 - 7:55 AM')).toBe('07:00')
    expect(uOfTStartTime('Opens at 9 PM')).toBeUndefined()
  })
  it('does not book a different minute in the same hour', () => {
    expect(uOfTTimeMatches('9:10 - 9:55 PM', '21:00')).toBe(false)
    expect(uOfTTimeMatches('7 - 7:50 PM', '19:30')).toBe(false)
  })
})
