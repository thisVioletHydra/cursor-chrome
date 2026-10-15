// Options page gate: without a valid link the page shows only the connect screen (same as the popup's bind mode);
// with a saved valid link but the server down → a «не на связи» status, sections closed, no key field.
// Pure decisions here (tested); options.ts only paints. Local data is never read while locked and never touched.
import type { GateView, LinkGate } from '../local/link-gate.ts';

import { gateView } from '../local/link-gate.ts';

// first paint trusts the stored gate (no TTL) to avoid a flash; the live check (strict) decides after
export function optionsView(gate: LinkGate | null | undefined, live: boolean, now = Date.now()): GateView {
  return gateView(gate, now, live);
}

export function optionsLocked(gate: LinkGate | null | undefined, live: boolean, now = Date.now()): boolean {
  return optionsView(gate, live, now) !== 'open';
}

// ids hidden while locked: tabs, data views, footer status
export const LOCKED_HIDDEN = ['tabs', 'status'] as const;
