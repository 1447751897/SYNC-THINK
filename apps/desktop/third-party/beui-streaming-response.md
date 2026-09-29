# Be UI Streaming Response adaptation

Upstream: https://beui.dev/components/agents/streaming-response
Source: https://beui.dev/r/streaming-response/raw
License: MIT, Copyright (c) 2026 Saurabh Chauhan. See beui-code-block.LICENSE. The notice ships in streaming-response.css.

StreamingResponse follows the upstream response-state, completion-actions and citation-disclosure pattern, adapted to Sync-Think's existing React 18 renderer and theme tokens. The 220ms footer entrance, small button press and source chevron transitions are local CSS equivalents, with reduced-motion support and no additional animation runtime.

- MessageTextContent/MarkdownContent continue to own incremental Markdown, code, HTML and deferred-content rendering. Changing response state never replaces their subtree.
- ChatView owns real copy/deferred reads, regeneration and resume callbacks. A response never replays a tool or an entire team directly. Copy uses the displayed final answer, not execution commentary.
- Sources retain existing external/file identities and navigation. AnswerSources owns disclosure state and keyboard access.
- Completion actions appear after generation; waiting for approval, pause, cancellation and errors remain distinct. Terminal details sit beside the answer, outside the collapsible execution trace.
- Feedback remains per-message UI state, matching the existing app. No remote feedback storage is claimed.
- Only status changes are announced; token chunks do not repeatedly announce the entire message.
