import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, BookingRequest } from '../shared/types'

contextBridge.exposeInMainWorld('bookingAPI', {
  getState: () => ipcRenderer.invoke('booking:get-state'),
  armBooking: (request: BookingRequest) => ipcRenderer.invoke('booking:arm', request),
  confirmReservation: () => ipcRenderer.invoke('booking:confirm-reservation'),
  cancelBooking: () => ipcRenderer.invoke('booking:cancel'),
  openLogin: () => ipcRenderer.invoke('booking:open-login'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  getHistory: () => ipcRenderer.invoke('history:get'),
  getSchedule: () => ipcRenderer.invoke('booking:get-schedule'),
  onStateChange: (listener) => { const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state as never); ipcRenderer.on('booking:state-change', handler); return () => ipcRenderer.removeListener('booking:state-change', handler) }
})
