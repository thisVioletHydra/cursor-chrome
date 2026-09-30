import { startWatch } from '@cursor-chrome/hh';
import { notifyOwner, setApplyGate, startAutopilot, startTelegram } from '@cursor-chrome/telegram';
import { publishExtLink } from '$lib/server/ext-link';
import { applySavedSecrets, CREATOR, takeVacancy } from '$lib/server/secrets';

publishExtLink();
await applySavedSecrets();
setApplyGate(item => takeVacancy(CREATOR, item));
startWatch(notifyOwner);
startTelegram();
startAutopilot();
