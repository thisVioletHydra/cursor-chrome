import { server } from './build/index.js';

const httpServer = server.server;
const attach = globalThis.cursorChromeExtLink;
if (httpServer !== undefined && typeof attach === 'function')
  attach(httpServer);
