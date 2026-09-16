import type { BookingApi } from '../shared/types'

declare global {
  interface Window {
    bookingAPI: BookingApi
  }
}

export {}
