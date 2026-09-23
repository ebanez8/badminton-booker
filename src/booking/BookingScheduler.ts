import { RELEASE_TIMING } from '../shared/releaseTiming'

export interface ScheduleCallbacks { prepare(): Promise<void>; release(): Promise<void>; waiting(): void; error(error: unknown): void }

export class BookingScheduler {
  // Recheck the wall clock so an OS time correction cannot leave a hours-long
  // monotonic timeout pointing at an obsolete deadline. No network polling.
  private static readonly maxTimerDelayMs = 1_000
  private timer?: NodeJS.Timeout
  private generation = 0

  arm(releaseAtMs: number, callbacks: ScheduleCallbacks, preparationLeadMs = RELEASE_TIMING.preparationLeadMs): void {
    this.cancel()
    const generation = this.generation
    this.scheduleAt(releaseAtMs - preparationLeadMs, generation, async () => {
      await callbacks.prepare()
      if (generation !== this.generation) return
      if (Date.now() < releaseAtMs) callbacks.waiting()
      this.scheduleAt(releaseAtMs, generation, callbacks.release, callbacks.error)
    }, callbacks.error)
  }

  private scheduleAt(atMs: number, generation: number, action: () => Promise<void>, onError: (error: unknown) => void): void {
    if (generation !== this.generation) return
    const remaining = atMs - Date.now()
    if (remaining <= 0) {
      this.timer = undefined
      void (async () => action())().catch((error: unknown) => { if (generation === this.generation) onError(error) })
      return
    }
    this.timer = setTimeout(() => {
      if (generation !== this.generation) return
      this.scheduleAt(atMs, generation, action, onError)
    }, Math.min(remaining > 20 ? remaining - 10 : 1, BookingScheduler.maxTimerDelayMs))
  }

  cancel(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
