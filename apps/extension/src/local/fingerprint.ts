// Device fingerprint for the access check. The extension only collects raw signals (shown openly in Debug);
// normalization, hashing, weights and thresholds live on the server, which stores hashes only.
export const SIGNALS = ['deviceId', 'gpu', 'os', 'fonts', 'screen', 'cores', 'memory', 'timezone', 'language'] as const;
export type SignalName = typeof SIGNALS[number];
export type RawSignals = Record<SignalName, string>;

const FONTS = ['Arial', 'Helvetica', 'Times New Roman', 'Courier New', 'Verdana', 'Georgia', 'Segoe UI', 'Roboto', 'Ubuntu', 'SF Pro Text', 'Menlo', 'Consolas', 'Calibri', 'Cambria', 'PT Sans', 'Noto Sans'];

function gpuRenderer(): string {
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl)
      return '';

    const ext = gl.getExtension('WEBGL_debug_renderer_info');

    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  }
  catch {
    return '';
  }
}

function fontList(): string {
  if (typeof document === 'undefined' || !document.fonts)
    return '';

  return FONTS.filter(font => document.fonts.check(`12px "${font}"`)).join(',');
}

export function collectRaw(deviceId: string): RawSignals {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } };
  const screenText = typeof screen === 'undefined' ? '' : `${screen.width}x${screen.height}@${globalThis.devicePixelRatio ?? 1}`;

  return {
    deviceId,
    gpu: gpuRenderer(),
    os: nav.userAgentData?.platform || nav.platform || '',
    fonts: fontList(),
    screen: screenText,
    cores: String(nav.hardwareConcurrency ?? ''),
    memory: String(nav.deviceMemory ?? ''),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: nav.language ?? '',
  };
}
