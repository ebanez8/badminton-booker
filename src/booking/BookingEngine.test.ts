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

  it('submits the selected court directly when the release callback runs', async () => {
    let release: (() => Promise<void>) | undefined
    let reserveCalls = 0
    const scheduler = new BookingScheduler()
    scheduler.arm = (_releaseAtMs, callbacks) => { release = callbacks.release }
    const bookingProvider: BookingProvider = {
      ...provider,
      getAvailability: async () => [{ id: 'Court 03-AC-Badminton|8', name: 'Court 03-AC-Badminton', available: true }],
      reserve: async () => { reserveCalls += 1; return { success: true, court: 'Court 03-AC-Badminton', message: 'Booked' } }
    }
    const engine = new BookingEngine(bookingProvider, scheduler, {
      maxRetries: 1, retryDelayMs: 1, saveHistory: async () => undefined, logger: { info: async () => undefined }
    })
    await engine.arm(request)
    await release?.()
    expect(reserveCalls).toBe(1)
    expect(engine.getState().status).toBe('confirmed')
  })
})
