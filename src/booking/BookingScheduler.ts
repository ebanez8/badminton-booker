export interface ScheduleCallbacks { prepare(): Promise<void>; release(): Promise<void>; waiting(): void }

export class BookingScheduler {
  private static readonly maxTimerDelayMs = 2_000_000_000
  private preparationTimer?: NodeJS.Timeout
  private releaseTimer?: NodeJS.Timeout
  private cancelled = false

  arm(releaseAtMs: number, callbacks: ScheduleCallbacks, preparationLeadMs = 120_000): void {
    this.cancelled = false
    this.schedulePreparation(releaseAtMs - preparationLeadMs, callbacks)
    this.scheduleRelease(releaseAtMs, callbacks)
  }

  private schedulePreparation(atMs: number, callbacks: ScheduleCallbacks): void {
    const delay = Math.max(0, atMs - Date.now())
    this.preparationTimer = setTimeout(async () => {
      if (this.cancelled) return
      if (Date.now() < atMs) return this.schedulePreparation(atMs, callbacks)
      await callbacks.prepare()
      if (!this.cancelled) callbacks.waiting()
    }, Math.min(delay, BookingScheduler.maxTimerDelayMs))
  }

  private scheduleRelease(atMs: number, callbacks: ScheduleCallbacks): void {
    const delay = Math.max(0, atMs - Date.now())
    this.releaseTimer = setTimeout(async () => {
      if (this.cancelled) return
      if (Date.now() < atMs) return this.scheduleRelease(atMs, callbacks)
      await callbacks.release()
    }, Math.min(delay, BookingScheduler.maxTimerDelayMs))
  }

  cancel(): void {
    this.cancelled = true
    if (this.preparationTimer) clearTimeout(this.preparationTimer)
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.preparationTimer = undefined
    this.releaseTimer = undefined
  }
}
