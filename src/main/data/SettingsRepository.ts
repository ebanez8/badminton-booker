import type { AppSettings } from '../../shared/types'
import { JsonStore } from './JsonStore'

export const defaultSettings: AppSettings = {
  bookingUrl: 'https://recreation.utoronto.ca/booking/33215bab-05b9-41de-be04-c9ae496d5609',
  defaultActivity: 'Badminton', defaultReleaseOffsetHours: 48, maxRetries: 3, retryDelayMs: 1000,
  showBrowser: true, headlessWhenAuthenticated: false, allowAnyCourt: true,
  defaultCourtOrder: ['Court 03-AC-Badminton', 'Court 02-AC-Badminton', 'Court 01-AC-Badminton']
}
export class SettingsRepository {
  constructor(private readonly store: JsonStore<AppSettings>) {}
  async get(): Promise<AppSettings> { return { ...defaultSettings, ...await this.store.read(), defaultReleaseOffsetHours: 48, defaultActivity: 'Badminton' } }
  async save(settings: AppSettings): Promise<AppSettings> {
    if (!settings || !Number.isInteger(settings.maxRetries) || settings.maxRetries < 1 || settings.maxRetries > 5 ||
        !Number.isFinite(settings.retryDelayMs) || settings.retryDelayMs < 250 || settings.retryDelayMs > 60000 ||
        typeof settings.showBrowser !== 'boolean' || typeof settings.allowAnyCourt !== 'boolean' ||
        !Array.isArray(settings.defaultCourtOrder) || !settings.defaultCourtOrder.every((court) => typeof court === 'string')) {
      throw new Error('Use 1–5 attempts and a retry delay between 250 and 60000 ms.')
    }
    const url = new URL(settings.bookingUrl)
    if (url.origin !== 'https://recreation.utoronto.ca' || !url.pathname.startsWith('/booking/')) throw new Error('Use the U of T recreation booking URL.')
    const normalized = { ...settings, defaultReleaseOffsetHours: 48, defaultActivity: 'Badminton' }
    await this.store.write(normalized)
    return normalized
  }
}
