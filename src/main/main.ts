import 'dotenv/config'
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { BrowserManager } from '../booking/automation/BrowserManager'
import { BookingEngine } from '../booking/BookingEngine'
import { BookingScheduler } from '../booking/BookingScheduler'
import { UofTBookingProvider } from '../booking/providers/UofTBookingProvider'
import { JsonStore } from './data/JsonStore'
import { defaultSettings, SettingsRepository } from './data/SettingsRepository'
import type { BookingHistoryEntry, BookingRequest, AppSettings } from '../shared/types'
import { Logger } from './logging/Logger'

let engine: BookingEngine
let settings: SettingsRepository
let history: JsonStore<BookingHistoryEntry[]>

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1040, height: 800, minWidth: 760, minHeight: 650,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else window.loadFile(join(__dirname, '../renderer/index.html'))
}

async function initializeServices(): Promise<void> {
  const dataDirectory = app.getPath('userData')
  settings = new SettingsRepository(new JsonStore(join(dataDirectory, 'settings.json'), defaultSettings))
  history = new JsonStore(join(dataDirectory, 'history.json'), [])
  const config = await settings.get()
  const browser = new BrowserManager(join(dataDirectory, 'browser-profile'), config.showBrowser)
  const provider = new UofTBookingProvider(browser, config.bookingUrl)
  engine = new BookingEngine(provider, new BookingScheduler(), {
    maxRetries: config.maxRetries, retryDelayMs: config.retryDelayMs,
    saveHistory: async (entry) => { const entries = await history.read(); await history.write([entry, ...entries]) },
    logger: Logger.at(dataDirectory)
  })
}

function registerIpc(): void {
  ipcMain.handle('booking:get-state', () => engine.getState())
  ipcMain.handle('booking:arm', (_event, request: BookingRequest) => engine.arm(request))
  ipcMain.handle('booking:confirm-reservation', () => engine.confirmReservation())
  ipcMain.handle('booking:cancel', () => engine.cancel())
  ipcMain.handle('booking:open-login', () => {
    const request = engine.getState().request
    return request ? engine.arm(request) : undefined
  })
  ipcMain.handle('settings:get', () => settings.get())
  ipcMain.handle('settings:save', (_event, value: AppSettings) => settings.save(value))
  ipcMain.handle('history:get', () => history.read())
  engine.subscribe((state) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('booking:state-change', state)))
}

app.whenReady().then(async () => { await initializeServices(); registerIpc(); createWindow() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => { void engine?.close() })
