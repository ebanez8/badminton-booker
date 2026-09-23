import { DateTime } from 'luxon'
import { TORONTO_ZONE } from '../booking/logic/releaseTime'
import type { ScheduleDay, ScheduleSlot } from '../shared/types'

/** Ticked courts are tried in this order. */
export const COURTS = ['Court 01-AC-Badminton', 'Court 02-AC-Badminton', 'Court 03-AC-Badminton']
export type SlotView = { armable: boolean; text: string; tone: 'open' | 'later' | 'full' | 'mine' }

export const hasBooking = (day: ScheduleDay): boolean => day.slots.some((slot) => slot.courts.some((entry) => entry.status === 'booked'))

/** What a slot card shows for the ticked courts. U of T allows one court booking per day. */
export function slotView(day: ScheduleDay, slot: ScheduleSlot, courts: string[], now = DateTime.now()): SlotView {
  const start = DateTime.fromISO(`${day.date}T${slot.time}`, { zone: TORONTO_ZONE })
  if (slot.courts.some((entry) => entry.status === 'booked')) return { armable: false, text: 'Booked by you', tone: 'mine' }
  if (hasBooking(day)) return { armable: false, text: 'One booking per day', tone: 'full' }
  if (start <= now) return { armable: false, text: 'Started', tone: 'full' }
  const relevant = slot.courts.filter((entry) => courts.includes(entry.court))
  const open = relevant.filter((entry) => entry.status === 'open').length
  if (open) return { armable: true, text: `Open now · ${open} court${open > 1 ? 's' : ''}`, tone: 'open' }
  if (relevant.some((entry) => entry.status === 'opens-later')) return { armable: true, text: `Opens ${start.minus({ hours: 48 }).toFormat('ccc h:mm a')}`, tone: 'later' }
  return { armable: false, text: relevant.length ? 'Full' : 'No chosen court', tone: 'full' }
}
