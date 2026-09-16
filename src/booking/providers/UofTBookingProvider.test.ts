import { describe, expect, it } from 'vitest'
import { uOfTDateButtonSelector } from './UofTBookingProvider'

describe('uOfTDateButtonSelector', () => {
  it('uses the one-based date attributes exposed by the U of T date picker', () => {
    expect(uOfTDateButtonSelector('2026-09-17')).toBe('button.single-date-select-button[data-year="2026"][data-month="9"][data-day="17"]')
  })

  it('rejects invalid ISO dates', () => {
    expect(() => uOfTDateButtonSelector('Sep 17, 2026')).toThrow('Invalid booking date')
  })
})
