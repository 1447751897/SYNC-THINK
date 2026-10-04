/** Windows ConPTY dimensions are positive signed 16-bit integer coordinates. */
const MAX_TERMINAL_DIMENSION = 32767;

export interface TerminalDimensions {
  cols: number;
  rows: number;
}

export const DEFAULT_TERMINAL_SIZE: Readonly<TerminalDimensions> = { cols: 80, rows: 24 };

export function isValidTerminalDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_TERMINAL_DIMENSION;
}

export function isValidTerminalSize(size: TerminalDimensions | undefined | null): size is TerminalDimensions {
  return Boolean(size && isValidTerminalDimension(size.cols) && isValidTerminalDimension(size.rows));
}
