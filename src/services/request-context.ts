import { AsyncLocalStorage } from 'node:async_hooks'

const organizationStorage = new AsyncLocalStorage<string | undefined>()

export function withOrganization<T>(organizationId: string | undefined, callback: () => T): T {
  return organizationStorage.run(organizationId, callback)
}

export function getRequestOrganizationId(): string | undefined {
  return organizationStorage.getStore()
}