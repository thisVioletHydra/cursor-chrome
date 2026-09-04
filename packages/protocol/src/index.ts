export const WS_HOST = '127.0.0.1';
export const WS_PORT = 18765;
export const WS_URL = `ws://${WS_HOST}:${WS_PORT}`;

export const COMMANDS = [
  'browser_navigate',
  'browser_new_tab',
  'browser_go_back',
  'browser_go_forward',
  'browser_snapshot',
  'browser_click',
  'browser_hover',
  'browser_type',
  'browser_select_option',
  'browser_press_key',
  'browser_wait',
  'browser_screenshot',
  'browser_get_console_logs',
  'ping',
] as const;

export type CommandName = (typeof COMMANDS)[number];

export interface WsRequest {
  id: string;
  method: CommandName;
  params: Record<string, unknown>;
}

export interface WsOk {
  id: string;
  ok: true;
  result: unknown;
}

export interface WsErr {
  id: string;
  ok: false;
  error: string;
}

export type WsResponse = WsOk | WsErr;

export interface NavigateParams {
  url: string;
}

export interface RefParams {
  element: string;
  ref: string;
}

export interface TypeParams extends RefParams {
  text: string;
  submit: boolean;
}

export interface SelectParams extends RefParams {
  values: string[];
}

export interface PressKeyParams {
  key: string;
}

export interface WaitParams {
  time: number;
}
