// DEV_NO_AUTH=1: local admin without GitHub login. Dev server + localhost only; ignored (with one warning) anywhere else.
export const DEV_USER = 'thisVioletHydra';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export type BypassInput = {
  flag: string | undefined;
  nodeEnv: string | undefined;
  railway: string | undefined;
  devServer: boolean;
  hostname: string;
};

export function productionLike(input: Omit<BypassInput, 'flag' | 'hostname'>): boolean {
  return input.nodeEnv === 'production' || Boolean(input.railway) || input.devServer === false;
}

export function devBypass(input: BypassInput): boolean {
  if (input.flag !== '1')
    return false;

  if (productionLike(input))
    return false;

  return LOCAL_HOSTS.has(input.hostname);
}

let warned = false;

export function warnIgnoredBypass(input: BypassInput, log: (text: string) => void = console.warn): void {
  if (warned || input.flag !== '1' || productionLike(input) === false)
    return;

  warned = true;
  log('DEV_NO_AUTH=1 игнорируется: это не dev-сервер (production). Вход только через GitHub.');
}
