import { setApplyGate, startTelegram } from '@cursor-chrome/telegram';
import { applySavedSecrets, CREATOR, takeVacancy } from '$lib/server/secrets';

await applySavedSecrets();
setApplyGate(() => takeVacancy(CREATOR));
startTelegram();
