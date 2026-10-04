export type { ReasoningEffort } from '@sync-think/shared';

export interface FloatingAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}

export type KernelInstallState =
  | { status: 'checking' }
  | { status: 'installing' }
  | { status: 'verifying' }
  | { status: 'success' }
  | { status: 'error'; error: string };
