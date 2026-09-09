import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

(globalThis as typeof globalThis & { SyncThinkXterm?: unknown }).SyncThinkXterm = {
  Terminal,
  FitAddon,
  WebLinksAddon,
};
