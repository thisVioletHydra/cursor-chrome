import { startTelegram } from '@cursor-chrome/telegram';
import { applySavedSecrets } from '$lib/server/secrets';

await applySavedSecrets();
startTelegram();
