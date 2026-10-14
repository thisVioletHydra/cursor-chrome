import { healthz } from '$lib/server/healthz';

export const GET = () => healthz();
export const HEAD = () => healthz();
