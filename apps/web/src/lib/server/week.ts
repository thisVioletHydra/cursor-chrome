import type { Account } from './secrets';

import { readState, watchNote, workHours, writeState } from '@cursor-chrome/hh';
import { isCreator, writeAccount } from './secrets';

const SHIFT_MINUTES = (22 - 9) * 60;
const WEEK_MINUTES = SHIFT_MINUTES * 5;
const GAP_MS = 2 * 60_000;

export function weekLoad(account: Account): number {
  return account.weekClicks / 10 + account.weekMinutes / WEEK_MINUTES;
}

export function weekOpen(login: string, account: Account): boolean {
  if (isCreator(login))
    return true;

  if (account.weekAt <= 0)
    return false;

  return weekLoad(account) < 1;
}

export async function noteWeekPulse(login: string, account: Account, device: string, now = Date.now()): Promise<Account> {
  if (isCreator(login) || account.weekAt <= 0 || workHours(new Date(now)) === false)
    return account;

  if (/^[A-Za-z0-9-]{8,80}$/.test(device)) {
    const last = account.weekDevices[device] ?? 0;
    const gap = now - last;
    if (last > 0 && gap > 0 && gap < GAP_MS)
      account.weekMinutes += gap / 60_000;

    account.weekDevices = { ...account.weekDevices, [device]: now };
    await writeAccount(login, account);
  }

  if (weekOpen(login, account) === false)
    await closeWeek();

  return account;
}

export async function noteWeekClick(login: string, account: Account): Promise<void> {
  if (isCreator(login) || account.weekAt <= 0)
    return;

  account.weekClicks += 1;
  await writeAccount(login, account);
  if (weekLoad(account) >= 1)
    await closeWeek();
}

export async function closeWeek(): Promise<void> {
  const state = await readState().catch(() => null);
  if (state !== null && state.auto === false)
    return;

  await writeState({ auto: false, hung: false });
  watchNote('server', 'неделя кончилась');
}
