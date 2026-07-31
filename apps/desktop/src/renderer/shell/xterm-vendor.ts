import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

(globalThis as typeof globalThis & { SyncThinkXterm?: unknown }).SyncThinkXterm = { Terminal };
