import type { CourtAvailability } from '../../shared/types'

export function chooseCourt(courts: CourtAvailability[], preferences: string[], allowAnyCourt: boolean): CourtAvailability | undefined {
  for (const preference of preferences) {
    const match = courts.find((court) => court.available && (court.id === preference || court.name === preference))
    if (match) return match
  }
  return allowAnyCourt ? courts.find((court) => court.available) : undefined
}

