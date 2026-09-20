import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ExtensionBridge } from './bridge';
import { registerTools } from './tools';

const log = (...args: unknown[]) => {
  console.error('[cursor-chrome]', ...args);
};

async function main(): Promise<void> {
  const bridge = new ExtensionBridge();
  await bridge.listen();
  log('ws listening on 127.0.0.1:18765');

  const server = new McpServer({
    name: 'cursor-chrome',
    version: '0.3.1',
  });
  registerTools(server, bridge);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('mcp stdio ready');

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown)
      return;
    shuttingDown = true;
    bridge.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.stdin.on('end', shutdown);
}

main().catch((error) => {
  console.error('[cursor-chrome]', error instanceof Error ? error.message : error);
  process.exit(1);
});
