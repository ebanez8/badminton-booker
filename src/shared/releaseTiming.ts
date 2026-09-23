/**
 * Release race timing, shared by the scheduler, the in-page booking loop and the
 * "How it works" panel. All times are relative to the 48-hour release instant.
 */
export const RELEASE_TIMING = {
  /** Load the booking page and select the date this long before release. */
  preparationLeadMs: 120_000,
  /** Start clicking the court tab this long before release (7:59:58.000 for an 8:00 slot). */
  startBeforeReleaseMs: 2_000,
  /** Court clicks start a random 20–50 ms apart (start to start), so the pattern is not a fixed-rate hammer. */
  minIntervalMs: 20,
  maxIntervalMs: 50,
  /** Re-click if the site has not replaced the slots within this time. */
  refreshTimeoutMs: 4_000,
  /** Give up this long after release (U of T opened ~1.4 s early on Sep 22; 30 s is ample). */
  stopAfterReleaseMs: 30_000
}
