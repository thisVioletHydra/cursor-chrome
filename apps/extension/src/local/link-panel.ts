// Popup/options strip: «Сервер: <host>» + link state. When not linked: «Не подключено к админке» /
// «Переподключи расширение…» and «Открыть админку». The connect-link input stays the existing form.
import { adminUrl, checkLink, gateOpen, gateText, type LinkGate, LINK_GATE_KEY, serverLine } from './link-gate.ts';

export function linkPanelParts(gate: LinkGate | null): { server: string; warn: string; admin: string } {
  return { server: serverLine(gate), warn: gateOpen(gate, gate?.at ?? 0) ? '' : gateText(gate), admin: gateOpen(gate, gate?.at ?? 0) ? '' : adminUrl(gate) };
}

type Area = { set: (items: Record<string, unknown>) => Promise<void> };

export async function paintLinkPanel(node: HTMLElement | null, url: string, key: string, area: Area | null, fetcher: typeof fetch = fetch): Promise<LinkGate> {
  const gate = await checkLink(url, key, fetcher);
  await area?.set({ [LINK_GATE_KEY]: gate }).catch(() => {});
  if (node === null)
    return gate;

  const parts = linkPanelParts(gate);
  node.hidden = false;
  node.className = parts.warn ? 'cc-link warn' : 'cc-link';
  node.replaceChildren();
  const server = document.createElement('div');
  server.textContent = parts.server;
  node.append(server);
  if (parts.warn) {
    const warn = document.createElement('div');
    warn.textContent = parts.warn;
    warn.style.color = '#b45309';
    node.append(warn);
    if (parts.admin) {
      const open = document.createElement('a');
      open.href = parts.admin;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = 'Открыть админку';
      node.append(open);
    }
  }

  return gate;
}
