import type { DeferredContent } from '@sync-think/shared';

export interface MessageTextPart {
  text: string;
  contentRef?: DeferredContent;
}
