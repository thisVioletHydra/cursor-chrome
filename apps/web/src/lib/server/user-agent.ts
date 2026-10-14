import rootPackage from '../../../../../package.json' with { type: 'json' };

// Нейтральный User-Agent без названия площадки.
export const APP_VERSION: string = rootPackage.version;
export const WEB_USER_AGENT = `NoJobNoProblemBuddy/${APP_VERSION}`;
