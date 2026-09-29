import type { ContainersApi } from '../shared/api'

declare global {
  interface Window {
    containers: ContainersApi
  }
}

export {}
