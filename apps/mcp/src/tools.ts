import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ExtensionBridge } from './bridge';

import { z } from 'zod';

function textResult(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text' as const, text }] };
}

function errorResult(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text' as const, text }], isError: true };
}

function locatorFields() {
  return {
    element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
    ref: z.string().optional().describe('Snapshot ref like e12 or f3e12. Pass this or selector, not both.'),
    selector: z.string().optional().describe('CSS selector if you already know it (e.g. textarea[data-qa="text-input"]). Pass this or ref, not both.'),
  };
}

function assertLocator(ref?: string, selector?: string): void {
  if (Boolean(ref) === Boolean(selector))
    throw new Error('Pass exactly one of ref or selector');
}

export function registerTools(server: McpServer, bridge: ExtensionBridge): void {
  server.registerTool(
    'browser_navigate',
    {
      description: 'Navigate the pinned HH worker tab. Never activates it, so YouTube stays put. Pin the tab in the Cursor Chrome popup first.',
      inputSchema: { url: z.string() },
    },
    async ({ url }) => {
      try {
        return textResult(await bridge.send('browser_navigate', { url }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_new_tab',
    {
      description: 'Open a tab without stealing focus (background defaults true). HH URLs get pinned as the worker tab. Clicks still go only to the pinned worker, not this new tab unless it becomes the worker.',
      inputSchema: {
        url: z.string().optional().describe('URL to open. Omit for a blank tab.'),
        background: z.boolean().optional().describe('Default true: do not activate. Pass false only if you must steal focus.'),
      },
    },
    async ({ url, background }) => {
      try {
        const params: Record<string, unknown> = { background: background !== false };
        if (url)
          params.url = url;

        return textResult(await bridge.send('browser_new_tab', params));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_go_back',
    { description: 'Go back in history', inputSchema: {} },
    async () => {
      try {
        return textResult(await bridge.send('browser_go_back'));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_go_forward',
    { description: 'Go forward in history', inputSchema: {} },
    async () => {
      try {
        return textResult(await bridge.send('browser_go_forward'));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_snapshot',
    {
      description: 'Accessibility snapshot of the pinned HH worker tab, including iframes. Use this for apply flows — screenshot captures the visible tab (YouTube) instead.',
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await bridge.send('browser_snapshot'));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_click',
    {
      description: 'Click in the pinned HH worker tab only. Never the active YouTube tab. Use selector if you know the CSS; otherwise snapshot and pass ref.',
      inputSchema: locatorFields(),
    },
    async ({ element, ref, selector }) => {
      try {
        assertLocator(ref, selector);

        return textResult(await bridge.send('browser_click', { element, ref, selector }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_hover',
    {
      description: 'Hover over an element. Use selector if you know the CSS; otherwise snapshot and pass ref.',
      inputSchema: locatorFields(),
    },
    async ({ element, ref, selector }) => {
      try {
        assertLocator(ref, selector);

        return textResult(await bridge.send('browser_hover', { element, ref, selector }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_type',
    {
      description: 'Type into an editable element. Use selector if you know the CSS; otherwise snapshot and pass ref. Set submit true only if you want Enter after typing.',
      inputSchema: {
        ...locatorFields(),
        text: z.string().describe('Text to type into the element'),
        submit: z.boolean().describe('Whether to submit entered text (press Enter after)'),
      },
    },
    async ({ element, ref, selector, text, submit }) => {
      try {
        assertLocator(ref, selector);

        return textResult(await bridge.send('browser_type', { element, ref, selector, text, submit }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_select_option',
    {
      description: 'Select an option in a dropdown. Use selector if you know the CSS; otherwise snapshot and pass ref.',
      inputSchema: {
        ...locatorFields(),
        values: z.array(z.string()).describe('Array of values to select in the dropdown. This can be a single value or multiple values.'),
      },
    },
    async ({ element, ref, selector, values }) => {
      try {
        assertLocator(ref, selector);

        return textResult(await bridge.send('browser_select_option', { element, ref, selector, values }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_press_key',
    {
      description: 'Press a key on the keyboard',
      inputSchema: {
        key: z.string().describe('Name of the key to press or a character to generate, such as ArrowLeft or a'),
      },
    },
    async ({ key }) => {
      try {
        return textResult(await bridge.send('browser_press_key', { key }));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_wait',
    {
      description: 'Wait for a specified time in seconds',
      inputSchema: {
        time: z.number().describe('The time to wait in seconds'),
      },
    },
    async ({ time }) => {
      const ms = Math.min(Math.max(time, 0), 30) * 1000;
      await new Promise(resolve => setTimeout(resolve, ms));
      return textResult(`waited ${ms / 1000} seconds`);
    },
  );

  server.registerTool(
    'browser_screenshot',
    {
      description: 'Screenshot the worker tab only if it is the visible tab in its window. Background HH will fail — use browser_snapshot for applies.',
      inputSchema: {},
    },
    async () => {
      try {
        const result = await bridge.send('browser_screenshot') as { data: string; mimeType: string };

        return {
          content: [{
            type: 'image' as const,
            data: result.data,
            mimeType: result.mimeType,
          }],
        };
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'browser_get_console_logs',
    {
      description: 'Get the console logs from the browser',
      inputSchema: {},
    },
    async () => {
      try {
        return textResult(await bridge.send('browser_get_console_logs'));
      }
      catch (error) {
        return errorResult(error);
      }
    },
  );
}
