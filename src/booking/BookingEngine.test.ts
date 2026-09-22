import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingEngine } from './BookingEngine'
import { BookingScheduler } from './BookingScheduler'
import { BookingError } from './errors/BookingError'
import type { BookingProvider } from './providers/BookingProvider'
import type { BookingRequest } from '../shared/types'

const request: BookingRequest = { activity: 'Badminton', date: '2026-09-20', time: '19:00', courtPreferences: ['Court 03-AC-Badminton'], allowAnyCourt: true, releaseRule: { mode: 'offset-hours', offsetHours: 48 } }
const provider: BookingProvider = {
  initialize: async () => undefined, isAuthenticated: async () => true, requestAuthentication: async () => undefined,
  prepare: async () => undefined, getAvailability: async () => [], reserve: async () => ({ success: false, message: 'unused' }), confirmReservation: async () => ({ success: false, message: 'unused' }), close: async () => undefined
}

describe('BookingEngine state transitions', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-18T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())
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

  it('cannot re-arm itself after cancellation during authentication', async () => {
    let finish!: (value: boolean) => void
    const scheduler = new BookingScheduler()
    const arm = vi.spyOn(scheduler, 'arm')
    const engine = new BookingEngine({ ...provider, isAuthenticated: () => new Promise(resolve => { finish = resolve }) }, scheduler, {
      maxRetries: 1, retryDelayMs: 1, saveHistory: async () => undefined, logger: { info: async () => undefined }
    })
    const pending = engine.arm(request)
    await Promise.resolve()
    engine.cancel()
    finish(true)
    await pending
    expect(engine.getState().status).toBe('cancelled')
    expect(arm).not.toHaveBeenCalled()
  })

  it('surfaces preparation failure without checking availability', async () => {
    const getAvailability = vi.fn(async () => [])
    const engine = new BookingEngine({ ...provider, prepare: async () => { throw new BookingError('PAGE_STRUCTURE_CHANGED', 'Missing picker') }, getAvailability }, new BookingScheduler(), {
      maxRetries: 3, retryDelayMs: 1, saveHistory: async () => undefined, logger: { info: async () => undefined }
    })
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
    await engine.arm(request)
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getState()).toMatchObject({ status: 'failed', error: { technicalMessage: 'Missing picker' } })
    expect(getAvailability).not.toHaveBeenCalled()
  })

  it('retries availability but never repeats an ambiguous submission', async () => {
    const court = { id: 'Court 03-AC-Badminton|1', name: 'Court 03-AC-Badminton', available: true }
    const getAvailability = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([court])
    const reserve = vi.fn(async () => { throw new BookingError('BOOKING_CONFIRMATION_FAILED') })
    const confirmReservation = vi.fn(async () => ({ success: true, message: 'Booked', court: court.name }))
    const saveHistory = vi.fn(async () => undefined)
    const engine = new BookingEngine({ ...provider, getAvailability, reserve, confirmReservation }, new BookingScheduler(), {
      maxRetries: 3, retryDelayMs: 10, saveHistory, logger: { info: async () => undefined }
    })
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
    await engine.arm(request)
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getState().status).toBe('confirmation-required')
    expect(getAvailability).toHaveBeenCalledTimes(2)
    expect(reserve).toHaveBeenCalledOnce()
    await engine.confirmReservation()
    expect(engine.getState().status).toBe('confirmed')
    expect(reserve).toHaveBeenCalledOnce()
    expect(confirmReservation).toHaveBeenCalledOnce()
    expect(saveHistory).toHaveBeenCalledOnce()
  })

  it('keeps a verified success confirmed even when local history cannot be written', async () => {
    const court = { id: 'Court 03-AC-Badminton|1', name: 'Court 03-AC-Badminton', available: true }
    const reserve = vi.fn(async () => ({ success: true, court: court.name, message: 'Booked' }))
    const engine = new BookingEngine({ ...provider, getAvailability: async () => [court], reserve }, new BookingScheduler(), {
      maxRetries: 3, retryDelayMs: 10, saveHistory: async () => { throw new Error('Disk full') }, logger: { info: async () => undefined }
    })
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
    await engine.arm(request)
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getState().status).toBe('confirmed')
    expect(engine.getState().message).toContain('Could not save local history')
    expect(engine.getState().timing?.confirmedAt).toBeDefined()
    await engine.confirmReservation()
    expect(reserve).toHaveBeenCalledOnce()
  })

  it('selects again if a court disappears before submission', async () => {
    const court = { id: 'Court 03-AC-Badminton|1', name: 'Court 03-AC-Badminton', available: true }
    const reserve = vi.fn().mockRejectedValueOnce(new BookingError('COURT_UNAVAILABLE')).mockResolvedValue({ success: true, court: court.name, message: 'Booked' })
    const getAvailability = vi.fn(async () => [court])
    const engine = new BookingEngine({ ...provider, getAvailability, reserve }, new BookingScheduler(), {
      maxRetries: 3, retryDelayMs: 10, saveHistory: async () => undefined, logger: { info: async () => undefined }
    })
    vi.setSystemTime(new Date('2026-09-19T12:00:00Z'))
    await engine.arm(request)
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.getState().status).toBe('confirmed')
    expect(getAvailability).toHaveBeenCalledTimes(2)
  })
})
