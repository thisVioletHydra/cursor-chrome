import rootPackage from '../../../../../package.json' with { type: 'json' };

// Нейтральный User-Agent без названия площадки.
export const WEB_USER_AGENT = `NoJobNoProblemBuddy/${rootPackage.version}`;
