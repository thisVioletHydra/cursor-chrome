import asyncHooks from 'node:async_hooks';

const OWNER = 'thisVioletHydra';

const slot = new asyncHooks.AsyncLocalStorage<string>();

export function runTenant<T>(login: string, job: () => T): T {
  return slot.run(login, job);
}

export function tenantLogin(): string {
  return slot.getStore() ?? '';
}

export function ownerLogin(login: string): boolean {
  return login.toLowerCase() === OWNER.toLowerCase();
}
