import { describe, expect, it } from 'vitest'
import { BookingEngine } from './BookingEngine'
import { BookingScheduler } from './BookingScheduler'
import type { BookingProvider } from './providers/BookingProvider'
import type { BookingRequest } from '../shared/types'

const request: BookingRequest = { activity: 'Badminton', date: '2026-09-20', time: '19:00', courtPreferences: ['Court 3'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const provider: BookingProvider = {
  initialize: async () => undefined, isAuthenticated: async () => true, requestAuthentication: async () => undefined,
  prepare: async () => undefined, getAvailability: async () => [], reserve: async () => ({ success: false, message: 'unused' }), close: async () => undefined
}

describe('BookingEngine state transitions', () => {
  it('arms authenticated valid request then cancels cleanly', async () => {
    const messages: string[] = []
    const engine = new BookingEngine(provider, new BookingScheduler(), {
      maxRetries: 1, retryDelayMs: 1, saveHistory: async () => undefined,
      logger: { info: async (message: string) => { messages.push(message) } }
    })
    expect((await engine.arm(request)).status).toBe('armed')
    expect(engine.cancel().status).toBe('cancelled')
    expect(messages).toContain('Booking armed.')
  })
})
