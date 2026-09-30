import type { WsResponse } from '@cursor-chrome/protocol';

import { NATIVE_CHUNK_BYTES } from '@cursor-chrome/protocol';

export function postNative(port: chrome.runtime.Port | null, message: WsResponse): void {
  if (port === null)
    return;

  const json = JSON.stringify(message);
  if (json.length <= NATIVE_CHUNK_BYTES) {
    port.postMessage(message);

    return;
  }

  const parts = Array.from(
    { length: Math.ceil(json.length / NATIVE_CHUNK_BYTES) },
    (_, index) => json.slice(index * NATIVE_CHUNK_BYTES, (index + 1) * NATIVE_CHUNK_BYTES),
  );
  port.postMessage({ type: 'chunk-start', id: message.id, total: parts.length });
  for (const [index, data] of parts.entries()) {
    port.postMessage({
      type: 'chunk',
      id: message.id,
      i: index,
      data,
    });
  }
}
