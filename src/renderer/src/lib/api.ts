import type { ContainersApi } from '../../../shared/api'

export function getApi(): ContainersApi {
  const api = (window as unknown as { containers?: ContainersApi }).containers
  if (!api) throw new Error('The containers bridge is unavailable. Restart the app.')
  return api
}
