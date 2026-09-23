import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { COURTS, slotView } from './slots'
import type { ScheduleDay, ScheduleSlot, SlotStatus } from '../shared/types'

const now = DateTime.fromISO('2026-09-22T21:45', { zone: 'America/Toronto' })
const slot = (time: string, label: string, statuses: SlotStatus[]): ScheduleSlot => ({ time, label, courts: COURTS.map((court, index) => ({ court, status: statuses[index] })) })

describe('calendar slot cards', () => {
  it('orders courts 1, 2, 3', () => {
    expect(COURTS).toEqual(['Court 01-AC-Badminton', 'Court 02-AC-Badminton', 'Court 03-AC-Badminton'])
  })

  it('offers nothing else on a day you already booked (one court per day)', () => {
    // Thursday Sep 24 as U of T showed it after booking 9 PM on Court 03.
    const thursday: ScheduleDay = { date: '2026-09-24', slots: [
      slot('21:00', '9 - 9:55 PM', ['unavailable', 'unavailable', 'booked']),
      slot('22:00', '10 - 10:50 PM', ['opens-later', 'opens-later', 'opens-later'])
    ] }
    expect(slotView(thursday, thursday.slots[0], COURTS, now)).toMatchObject({ armable: false, text: 'Booked by you' })
    expect(slotView(thursday, thursday.slots[1], COURTS, now)).toMatchObject({ armable: false, text: 'One booking per day' })
  })

  it('arms open and not-yet-open slots only on the ticked courts', () => {
    const friday: ScheduleDay = { date: '2026-09-25', slots: [
      slot('20:00', '8 - 8:55 PM', ['opens-later', 'unavailable', 'unavailable']),
      slot('21:00', '9 - 9:55 PM', ['unavailable', 'open', 'unavailable']),
      slot('22:00', '10 - 10:50 PM', ['unavailable', 'unavailable', 'unavailable'])
    ] }
    expect(slotView(friday, friday.slots[0], COURTS, now)).toMatchObject({ armable: true, text: 'Opens Wed 8:00 PM' })
    expect(slotView(friday, friday.slots[1], COURTS, now)).toMatchObject({ armable: true, text: 'Open now · 1 court' })
    expect(slotView(friday, friday.slots[1], ['Court 01-AC-Badminton'], now)).toMatchObject({ armable: false, text: 'Full' })
    expect(slotView(friday, friday.slots[2], COURTS, now)).toMatchObject({ armable: false, text: 'Full' })
  })

  it('does not offer a slot that has started', () => {
    const tuesday: ScheduleDay = { date: '2026-09-22', slots: [slot('21:00', '9 - 9:55 PM', ['unavailable', 'open', 'unavailable'])] }
    expect(slotView(tuesday, tuesday.slots[0], COURTS, now)).toMatchObject({ armable: false, text: 'Started' })
  })
})
