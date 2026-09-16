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
  get(): Promise<AppSettings> { return this.store.read() }
  async save(settings: AppSettings): Promise<AppSettings> { await this.store.write(settings); return settings }
}
