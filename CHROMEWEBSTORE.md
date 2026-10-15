# NoJobNoProblemBuddy — store preparation

Updated: 2026-10-15. Internal development build; this document does not confirm store submission or approval.

## Purpose

Job-search assistant with a vacancy queue, application history, site filtering and an optional automatic processing mode. The current manifest description says users press submit; automatic processing also exists in the code. Reconcile the listing with actual behavior before submission.

## Manifest permissions

Source: `apps/extension/src/manifest.json` (Manifest V3).

- `alarms`: scheduled queue processing and background checks.
- `activeTab`: access to the active tab following an extension action.
- `scripting`: execute page inspection and job-site interaction scripts.
- `tabs`: find, open, focus and manage the worker tab and inspect tab URLs.
- `offscreen`: keep the local WebSocket bridge in an offscreen document.
- `storage`: persist connection credentials, preferences, worker state and activity records locally.
- `nativeMessaging`: connect to the installed native host from the background worker.
- Host permission `<all_urls>`: the browser automation bridge can inspect and interact with arbitrary requested pages. Content scripts also run on `<all_urls>`, in all frames at document start. This is broader than job-site-only access and needs explicit store justification or narrowing before submission.

## Data handling

Connection URLs and keys are configured by the user and stored locally. Requests to the configured administration server use authentication and exchange queue entries, vacancy information, application results and diagnostic records. Resume information is retrieved by the debug workflow. Job-site requests can use the user's existing authenticated session. The local native host and WebSocket bridge carry automation requests and results; page access can expose page content and user activity.

In server mode the configured server receives DOM snapshots, form field metadata and answers to plan browser actions. Command payloads and acknowledgements are journaled on its existing volume. The browser stores execution receipts, scoped by a hash of the connection token, to prevent duplicate actions. Connection tokens never enter that command journal. No analytics or new permissions are added.

## Publication requirements still pending

Public privacy policy URL, publisher/contact details, final data disclosure, permission review, accurate listing text and store screenshots must be prepared and verified before Chrome Web Store submission. Microsoft Edge Add-ons requirements must be verified separately if publishing there.

## Version history

- 0.5.130: bounded connection checks, account-safe history, saved power toggle, admin review navigation and build identification. No new permissions. Connection health checks send only the configured extension token to its server.

- 0.5.131: durable account-scoped command delivery and crash-safe execution receipts. Command payloads and report acknowledgements are journaled on the configured server volume; local receipts are scoped by a hash of the connection token. No added permissions.

- 0.5.132: server planner converts search, form answers and submission into navigate/click/type/select/readDOM/wait. Legacy scenarios remain behind the account switch. Form snapshots and answer text travel to the configured server for processing.

- 0.5.133: admin scenario controls and server-mode switch, popup status/link/power view, account-isolated history counts, review form capture and human-approved answers. Existing IndexedDB, storage and volume data are retained; legacy thin SQLite settings are read without modification and new settings are written to JSON.
