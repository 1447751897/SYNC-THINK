// Explicit presentation boundary used by the public Website demo.
// Demo state and orchestration belong to apps/website; Desktop only exposes real UI pieces.
export { AgentLibrary } from './AgentLibrary.js';
export { AskQuestionCard, type PendingAsk } from './AskQuestionCard.js';
export { BrowserHandoffCard } from './BrowserHandoffCard.js';
export { CodeBlock } from './CodeBlock.js';
export { ComposeRequestQueue } from './ComposeRequestQueue.js';
export { ComposerAddControl } from './ComposerAddMenu.js';
export { ComposerApprovalStack } from './ComposerApprovalStack.js';
export { ComposerEditor, type ComposerEditorHandle } from './ComposerEditor.js';
export { CopyTextButton } from './CopyTextButton.js';
export { DeferredFileDiff } from './DeferredFileDiff.js';
export { DesktopWaitingCard } from './DesktopWaitingCard.js';
export { DialogProvider } from './Dialog.js';
export { InlineProcessFlow } from './InlineProcessFlow.js';
export { KernelUpdatePanel } from './KernelUpdatePanel.js';
export { MarkdownContent } from './MarkdownContent.js';
export { PlanApprovalCard } from './PlanApprovalCard.js';
export { TeamLibrary } from './TeamLibrary.js';
export { ToolApprovalCard } from './ToolApprovalCard.js';
export { WorkspaceWorkbench } from './WorkspaceWorkbench.js';
export { createQueuedComposeRequest, type QueuedComposeRequest } from './compose-request-queue.js';
export type { ComposeAttachment } from './compose-mention.js';
export {
  ContextRing,
  IdentityPickerMenu,
  ModelPickerMenu,
  ModelTrigger,
  PermissionMenu,
  SkillPickerMenu,
  PERMISSION_OPTIONS,
  REASONING_LABELS,
  useComposerToolbarCollapse,
  type IdentityOption,
  type PermissionMode,
  type ReasoningEffort,
} from './compose-toolbar.js';
export type { InlineProcessItem } from './conversation-types.js';
export { resolveKernelDisplayName } from './brand-icons.js';
export type { WorkbenchScope, WorkbenchTab } from './workspace-workbench.js';
export type {
  ManagedKernelUpdateBridge,
  ManagedKernelUpdateSnapshot,
} from '../../kernel-update-contract.js';
