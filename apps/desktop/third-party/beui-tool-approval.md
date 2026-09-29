# Be UI Tool Approval adaptation

Upstream: https://beui.dev/components/agents/tool-approval
Source: https://beui.dev/r/tool-approval.json
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See beui-code-block.LICENSE; the notice also ships in tool-approval.css.

The React 18 adaptation follows the upstream icon/title/tool/status header, collapsible parameters, acknowledgement states, scope actions and reduced-motion behavior. It uses existing Sync-Think tokens, icons, CodeBlock and File Diff surfaces; CSS handles the disclosure/press transitions without introducing a second motion or highlighting runtime.

- The composer retains a single actionable approval and shows the remaining queue count.
- Buttons reflect Runtime allowedScopes (once/session/always-app); only a valid computer-use app may offer persistent app access.
- The collapsed card presents a human-readable action, affected targets and the kernel's approval reason. Native tool ids, timestamps, environment/process ids and permission protocol metadata stay out of the user-facing card. Session scope is explicitly labelled as permission for the same tool.
- Details render the actual command, proposed file change or relevant parameters, on demand. Replacement snippets are labelled as snippets and do not imply complete file contents. No file is read or changed for a preview.
- Busy state waits for conversation.decideToolApproval. Failed submissions remain retryable. Acknowledged ids suppress stale pending snapshots; requests are guarded against double submission and cross-conversation completions.
- Runtime persists one timeline receipt per approval id; the tool's actual execution status and output remain owned by the existing Tool Result flow.
- Expired requests retain the existing recovery workflow; no expired approval can grant permissions.
