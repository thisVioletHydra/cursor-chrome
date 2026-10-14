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

This popup redesign adds no permissions, endpoints, analytics or external assets. It does not change data handling.

## Publication requirements still pending

Public privacy policy URL, publisher/contact details, final data disclosure, permission review, accurate listing text and store screenshots must be prepared and verified before Chrome Web Store submission. Microsoft Edge Add-ons requirements must be verified separately if publishing there.
