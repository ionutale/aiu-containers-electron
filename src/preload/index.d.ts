import type { ElectronAPI } from '@electron-toolkit/preload'
import type { ContainersApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    containers: ContainersApi
  }
}

export {}
