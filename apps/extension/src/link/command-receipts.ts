// Record before touching a page. A worker crash after that point is ambiguous: never execute it again.
import type { Wire, Outcome } from './server-link.ts';

type Area = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};
type Receipt = { id: string; until: number; outcome?: Outcome };
export function idempotentExecutor(
  area: Area,
  token: () => Promise<string>,
  exec: (cmd: Wire) => Promise<Outcome>,
  now = Date.now,
) {
  let tail: Promise<unknown> = Promise.resolve();
  return (cmd: Wire): Promise<Outcome> => {
    const run = async (): Promise<Outcome> => {
      const key = await token();
      if (key.trim() === null || key.trim() === undefined) return { ok: false, error: 'нет аккаунта' };

      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(key),
      );
      const scope = `ext-receipts:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      const rows = ((await area.get(scope))[scope] ?? []) as Receipt[];
      const prior = rows.find((r) => r.id === cmd.id);
      if (prior)
        return (
          prior.outcome ?? {
            ok: false,
            error:
              'выполнение прервано; повтор запрещён, проверь результат вручную',
          }
        );

      if (cmd.deadline && cmd.deadline < now())
        return { ok: false, error: 'команда истекла' };

      const receipt: Receipt = {
        id: cmd.id,
        until: (cmd.deadline || now() + 120_000) + 86400_000,
      };
      const keep = rows.filter((r) => r.until > now());
      keep.push(receipt);
      await area.set({ [scope]: keep });
      try {
        receipt.outcome = await exec(cmd);
      } catch (error) {
        receipt.outcome = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      await area.set({ [scope]: keep });

      return receipt.outcome;
    };
    const previous = tail;
    let release: () => void = () => {};
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return (async () => {
      await previous;
      try {
        return await run();
      } finally {
        release();
      }
    })();
  };
}
