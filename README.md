# Cursor Chrome

**Your real Chrome / Edge, driven from Cursor.** Same cookies, same logins, same tabs. Not a second Playwright browser.

Store Browser MCP dies with the MV3 service worker. This one keeps the socket in a native host, talks to Cursor over local MCP, and clicks the page you already have open.

<p align="center">
  <img src="apps/extension/src/icons/icon128.png" width="96" height="96" alt="Cursor Chrome" />
</p>

```
Cursor  ──stdio MCP──►  Node :18765  ◄──native messaging──  Edge extension
                                                      │
                                                      ▼
                                               your tabs (cookies included)
```

| Popup | Meaning |
| --- | --- |
| **NATIVE** | `connectNative` is up. This is the path that stays alive. |
| **OFFSCREEN** | Fallback WebSocket. Host missing or crashed. |
| **OFF** | Cursor MCP is not listening on `127.0.0.1:18765`. |

---

## Install

Need **pnpm**, **Node 20+**, and **Edge** (Chrome works the same).

```bash
git clone https://github.com/thisVioletHydra/cursor-chrome.git
cd cursor-chrome
pnpm install
pnpm build
pnpm install-host
```

`install-host` writes native-messaging manifests for Edge and Chrome and pins a stable extension id.

### 1. Load the extension

Edge: `edge://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist`.

Reload the unpacked build after every `pnpm build`. First load after `install-host` must happen so the `key` in the manifest matches the host.

### 2. Point Cursor at the MCP

In `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cursor-chrome": {
      "command": "node",
      "args": ["/ABS/PATH/cursor-chrome/apps/mcp/dist/index.js"]
    }
  }
}
```

Use the absolute path on your machine. Remove or disable the store `browsermcp` entry — two servers on `:18765` will fight.

Cursor Settings → MCP → **Reload** `cursor-chrome`. New tools (`selector`, `browser_new_tab`, …) do not appear in an old chat until that reload.

### 3. Check the popup

Click the toolbar icon. You want **NATIVE** and the current tab URL. If it says `pnpm install-host`, the native host is not registered for this extension id.

---

## Agent tools

Click / type / hover / select take **exactly one** of `ref` or `selector`.

| Tool | What it does |
| --- | --- |
| `browser_snapshot` | Accessibility tree, **all iframes**, shadow roots. Refs: `e12` (top) / `f3e12` (frame). |
| `browser_click` | Click by snapshot `ref` or CSS `selector`. |
| `browser_type` | Fill input / textarea / contenteditable. `submit: true` presses Enter. |
| `browser_hover` | Hover. |
| `browser_select_option` | `<select>`. |
| `browser_press_key` | Key on the focused element. |
| `browser_navigate` | Replace the **current** tab URL. |
| `browser_new_tab` | Open a new tab. Prefer this if the current page should stay. |
| `browser_go_back` / `browser_go_forward` | History. |
| `browser_wait` | Sleep, max 30s. |
| `browser_screenshot` | PNG of the visible tab. Edge sometimes fails if the tab is covered. |
| `browser_get_console_logs` | Page `console.*` buffer. |

Example: you already know the field.

```json
{
  "element": "chat composer",
  "selector": "textarea[data-qa=\"text-input\"]",
  "text": "hello",
  "submit": false
}
```

Otherwise snapshot → use `ref`.

---

## Layout

```
apps/mcp            Cursor stdio MCP + WebSocket server on 127.0.0.1:18765
apps/native-host    Chrome native messaging relay (Node)
apps/extension      MV3 unpacked extension (offscreen = fallback WS + keepalive)
packages/protocol   Shared command names and wire types
```

The service worker is not allowed to live forever. `chrome.runtime.connectNative` is the Chromium-blessed way to keep it up while Edge is running. Offscreen WebSocket is the backup if the host is missing.

---

## Limits

- **Edge (or Chrome) must stay running.** Lid close / sleep / quit kills the channel. Background tabs are fine; a dead browser is not.
- `chrome://`, `edge://`, `about:` — no inject, no click.
- Screenshot wants a visible tab.
- After changing MCP tool schemas, **Reload MCP** or start a new chat. The extension reload is not enough.
- Local only: the socket binds `127.0.0.1`. Nothing is exposed to the LAN.

---

## Scripts

```bash
pnpm build           # all packages
pnpm install-host    # register native host for Edge + Chrome
pnpm dev             # run the MCP in the foreground (debug)
```

Requires Cursor with MCP enabled. Unpacked MV3 only — not on the Chrome Web Store.
