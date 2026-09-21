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

  const total = Math.ceil(json.length / NATIVE_CHUNK_BYTES);
  port.postMessage({ type: 'chunk-start', id: message.id, total });
  for (let index = 0; index < total; index++) {
    port.postMessage({
      type: 'chunk',
      id: message.id,
      i: index,
      data: json.slice(index * NATIVE_CHUNK_BYTES, (index + 1) * NATIVE_CHUNK_BYTES),
    });
  }
}
