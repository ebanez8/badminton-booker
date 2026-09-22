import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingScheduler } from './BookingScheduler'

describe('BookingScheduler', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-21T12:00:00Z')) })
  afterEach(() => vi.useRealTimers())

  it('prepares early and releases once at the deadline, never a millisecond early', async () => {
    const prepare = vi.fn(async () => undefined)
    const release = vi.fn(async () => undefined)
    const waiting = vi.fn()
    const at = Date.now() + 125_000
    new BookingScheduler().arm(at, { prepare, release, waiting, error: vi.fn() })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(prepare).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(prepare).toHaveBeenCalledOnce()
    expect(waiting).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(119_999)
    expect(release).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(release).toHaveBeenCalledOnce()
    expect(Date.now()).toBe(at)
  })

  it('responds to a forward wall-clock correction within one second', async () => {
    const release = vi.fn(async () => undefined)
    const at = Date.now() + 90_000
    new BookingScheduler().arm(at, { prepare: async () => undefined, release, waiting: vi.fn(), error: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    vi.setSystemTime(at)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(release).toHaveBeenCalledOnce()
  })

  it('does not release early after a backward wall-clock correction', async () => {
    const release = vi.fn(async () => undefined)
    const at = Date.now() + 1_000
    new BookingScheduler().arm(at, { prepare: async () => undefined, release, waiting: vi.fn(), error: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    vi.setSystemTime(Date.now() - 1_000)
    await vi.advanceTimersByTimeAsync(1_998)
    expect(release).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(release).toHaveBeenCalledOnce()
  })

  it('waits for slow preparation even when release is already due', async () => {
    let finish!: () => void
    const release = vi.fn(async () => undefined)
    const scheduler = new BookingScheduler()
    scheduler.arm(Date.now() - 1, {
      prepare: () => new Promise<void>((resolve) => { finish = resolve }),
      release, waiting: vi.fn(), error: vi.fn()
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(release).not.toHaveBeenCalled()
    finish()
    await vi.advanceTimersByTimeAsync(10)
    expect(release).toHaveBeenCalledOnce()
  })

  it('reports preparation failure and never submits', async () => {
    const failure = new Error('Date not loaded')
    const error = vi.fn()
    const release = vi.fn(async () => undefined)
    new BookingScheduler().arm(Date.now() + 1000, {
      prepare: async () => { throw failure }, release, waiting: vi.fn(), error
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(error).toHaveBeenCalledWith(failure)
    expect(release).not.toHaveBeenCalled()
  })

  it('does not revive a cancelled preparation when another booking is armed', async () => {
    let finish!: () => void
    const oldRelease = vi.fn(async () => undefined)
    const newRelease = vi.fn(async () => undefined)
    const scheduler = new BookingScheduler()
    scheduler.arm(Date.now(), { prepare: () => new Promise<void>((resolve) => { finish = resolve }), release: oldRelease, waiting: vi.fn(), error: vi.fn() })
    await vi.advanceTimersByTimeAsync(1)
    scheduler.cancel()
    scheduler.arm(Date.now() + 100, { prepare: async () => undefined, release: newRelease, waiting: vi.fn(), error: vi.fn() })
    finish()
    await vi.advanceTimersByTimeAsync(200)
    expect(oldRelease).not.toHaveBeenCalled()
    expect(newRelease).toHaveBeenCalledOnce()
  })
})
