import asyncHooks from 'node:async_hooks';
import process from 'node:process';

const OWNER = 'thisVioletHydra';

const slot = new asyncHooks.AsyncLocalStorage<string>();

export function runTenant<T>(login: string, job: () => T): T {
  return slot.run(login, job);
}

export function tenantLogin(): string {
  return slot.getStore() ?? '';
}

// The owner login (account file name), not personal data.
export function ownerName(): string {
  return process.env.HH_OWNER || OWNER;
}

export function ownerLogin(login: string): boolean {
  return login.toLowerCase() === OWNER.toLowerCase();
}
