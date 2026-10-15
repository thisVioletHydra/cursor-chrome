# Thin client implementation audit

Source: `thin-client-wip` at `aa8c752`; migration source: `bots-wip` at `8d9cd14`.
Work was performed entirely in the cloud clone. No deployment was performed.

## A — connection and admin fixes

Connection confirmation uses three bounded read-only observations (2-second timeout,
5-second spacing: 10–16 seconds), followed by the existing increasing backoff capped
at 15 minutes. A failed mutation is never blindly retried. Power state continues to
use the existing pilot state machine and storage. Review no longer redirects when
profile data is missing. The admin save button has contrast. The sidebar uses the
Railway commit with a build-time Git fallback. Unknown login never sees legacy-owner
history; deduplication and daily counts are scoped by owner.

Popup HTML and CSS are unchanged from `184a3a0`. Only popup behavior changes; its
existing labels are retained. Disconnected mode is the connection-key screen.

## B — transport

`/api/ext/*` resolves Bearer extToken to an account. Long-poll waits up to 25 seconds.
Commands are journaled atomically to `ext-commands.json` on the existing volume,
without a new database or worker. Reports are acknowledged idempotently. Restarted
servers redeliver the same command ID. The browser writes a receipt before executing
and stores its result. An interrupted operation is refused on redelivery, requiring
manual verification rather than duplicate submission. Receipts are token-hash scoped.
Changing credentials while a poll is outstanding prevents execution of its command.

## C — migration and server scenarios

Transferred from bots-wip: plan/index, scenarios, types, deps-impl and its tenant
isolation tests; thin/plan-deps and wiring; thin-answers and the resume-kind path
through hh-apply-cmd, apply-fill, apply-run, content and server-exec. The build SHA
fallback and contrasting save button also originated there.

The production planner adapter expands semantic form application into navigate,
click, type, select, readDOM and wait. Resume selection, answer matching, letter
insertion, submission and confirmation decisions are server-side. Unconfirmed
submissions require human review. Form capture and approved review answers use the
existing per-tenant storage. Old extension scenarios remain available while the
account's server-planner flag is off; they are suppressed in server mode.

Captcha/login/detect holds require explicit re-enabling after manual resolution;
a persisted run epoch clears the server hold only on that user action.

## D — settings and delivery

The existing admin extension settings page now controls the account planner flag
and scenario switches. Pace, hours, queries, profile and letter use their existing
admin pages. Automatic invitation replies remain disabled. The extension fetches
ETag-aware configuration before polling. Server-mode popup shows link, status and
power using existing markup and strings.

The unfinished plan-flags/ext-settings SQLite files, if present, are read-only
migration sources. New settings go into JSON on the existing volume. Migration tests
verify byte-for-byte preservation of the legacy database. IndexedDB and existing
chrome.storage are not cleared. The manifest key and extension ID are preserved.
Final extension version: 0.5.133.

## Validation

- All discovered ext/web/hh tests: 354 total, 348 passed, 0 failed, 6 skipped.
- Extension and SvelteKit production builds pass.
- Strict TypeScript check of primitive planner, command bus, account JSON and browser
  receipts passes (including their transport dependencies).
- Popup HTML/CSS comparison with 184a3a0 is empty.
- Built manifest key derives ID ofiopelmbodnjmcedjhllhgmpnabaibk.
- No active old production host: the generic old-host migration pattern and its
  synthetic test deliberately remain so existing saved connection URLs can migrate.

Commands use the root pin pnpm@12.11.2 through Corepack. Tests run via
`corepack pnpm exec node --import tsx --test --test-timeout=25000` and all discovered
`.test.mjs`/`.test.ts` files. The tsx CLI itself cannot bind its IPC Unix socket in
this cloud sandbox; the Node loader does not require that socket.

## Limits and rollout

No cloud Edge executable, signed-in hh session, real hh fixtures or account data are
available. Six fixture/account-dependent tests are skipped. Real hh DOM variations
therefore remain a rollout risk; missing selectors, ambiguous execution and missing
answers stop safely for manual review. No real application was submitted in testing.

Repository-wide lint and the extension-wide TypeScript check are not clean; their
logs include existing legacy typing/style issues as well as style findings in the
changed area. They are not represented as passing checks. Focused transport typing,
all ext/web/hh tests and both production builds are the completed validation gates.

The server planner remains off per account until explicitly enabled in the admin.
Publishing/deployment and Chrome Web Store submission are outside this change.
