// Device fingerprint for the access check. Raw values stay local; only sha256 hashes go to the server.
// Collected openly (shown in Debug), not hidden.
export const SIGNALS = ['deviceId', 'gpu', 'os', 'fonts', 'screen', 'cores', 'memory', 'timezone', 'language'] as const;
export type SignalName = typeof SIGNALS[number];
export type RawSignals = Record<SignalName, string>;

// «ANGLE (NVIDIA, NVIDIA GeForce RTX 4050 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)» → «nvidia rtx 4050»
export function gpuChip(renderer: string): string {
  const text = renderer.toLowerCase();
  const vendor = /nvidia|geforce/.test(text) ? 'nvidia' : /amd|radeon/.test(text) ? 'amd' : /intel/.test(text) ? 'intel' : /apple/.test(text) ? 'apple' : /swiftshader|llvmpipe|software/.test(text) ? 'software' : 'other';
  const model = text.match(/\b(rtx|gtx|mx|rx|arc|iris(?: xe)?|uhd|hd|m\d)\s*(?:graphics\s*)?(\d{2,4}[a-z]?)?\b/);
  const apple = text.match(/apple (m\d(?: pro| max| ultra)?)/);

  return [vendor, apple ? apple[1] : model ? [model[1], model[2]].filter(Boolean).join(' ') : ''].filter(Boolean).join(' ').trim();
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));

  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashSignals(raw: RawSignals): Promise<Record<SignalName, string>> {
  const out = {} as Record<SignalName, string>;
  for (const name of SIGNALS)
    out[name] = await sha256Hex(`${name}:${raw[name] ?? ''}`);

  return out;
}

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
    gpu: gpuChip(gpuRenderer()),
    os: nav.userAgentData?.platform || nav.platform || '',
    fonts: fontList(),
    screen: screenText,
    cores: String(nav.hardwareConcurrency ?? ''),
    memory: String(nav.deviceMemory ?? ''),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: nav.language ?? '',
  };
}
