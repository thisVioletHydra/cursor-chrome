// Extension version policy. Both versions come from env (defaults: min 0.0.0, recommended = current build).
// Below recommended → response flag + signed download link; below min → 426 on everything but config and dl.
export type Policy = { min: string; recommended: string };

export function parseVersion(text: string): number[] | null {
  const match = text.trim().match(/^(\d+)\.(\d+)\.(\d+)/);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left) ?? [0, 0, 0];
  const b = parseVersion(right) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i])
      return a[i] < b[i] ? -1 : 1;
  }

  return 0;
}

export function policyOf(env: Record<string, string | undefined>, build: string): Policy {
  const min = parseVersion(env.EXT_MIN_VERSION ?? '') ? String(env.EXT_MIN_VERSION) : '0.0.0';
  const recommended = parseVersion(env.EXT_RECOMMENDED_VERSION ?? '') ? String(env.EXT_RECOMMENDED_VERSION) : (parseVersion(build) ? build : min);

  return { min, recommended };
}

export const VERSION_FREE = (pathname: string) => pathname === '/api/config' || pathname.startsWith('/dl/');

// null header = old extension that does not send its version: never blocked (old endpoints keep working).
export function versionGate(pathname: string, version: string | null, policy: Policy): { status: 200 | 426; outdated: boolean } {
  if (version === null || parseVersion(version) === null)
    return { status: 200, outdated: false };

  const outdated = compareVersions(version, policy.recommended) < 0;
  if (compareVersions(version, policy.min) < 0 && VERSION_FREE(pathname) === false)
    return { status: 426, outdated: true };

  return { status: 200, outdated };
}
