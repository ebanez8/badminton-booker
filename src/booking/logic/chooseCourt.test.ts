import { describe, expect, it } from 'vitest'
import { chooseCourt } from './chooseCourt'

describe('chooseCourt', () => {
  it('chooses first available preference', () => {
    const court = chooseCourt([
      { id: '1', name: 'Court 1', available: true }, { id: '2', name: 'Court 2', available: true }
    ], ['Court 3', 'Court 2', 'Court 1'], false)
    expect(court?.name).toBe('Court 2')
  })
  it('does not select an unwanted court without fallback', () => {
    expect(chooseCourt([{ id: '4', name: 'Court 4', available: true }], ['Court 3', 'Court 2'], false)).toBeUndefined()
  })
  it('uses available fallback when allowed', () => {
    expect(chooseCourt([{ id: '4', name: 'Court 4', available: true }], ['Court 3', 'Court 2'], true)?.name).toBe('Court 4')
  })
})
