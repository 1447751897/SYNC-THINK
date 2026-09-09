import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MarkdownContent } from '../../apps/desktop/src/renderer/shell/MarkdownContent.js';
import { getExportSvg, svgToPngBlob } from '../../apps/desktop/src/renderer/mermaid/mermaid-render.js';

const fence = (language: string, body: string, closed = true) =>
  '```' + language + '\n' + body + (closed ? '\n```\n' : '');

const counter = '<main style="padding:16px;font:16px system-ui;color:#202020;background:#fff"><h3 style="margin:0 0 12px">Interactive preview</h3><button id="counter" onclick="this.textContent=String(Number(this.textContent)+1)">0</button><button id="grow" onclick="document.getElementById(\'extra\').style.height=\'480px\'">Grow</button><button id="shrink" onclick="document.getElementById(\'extra\').style.height=\'0\'">Shrink</button><div id="extra" style="height:0;background:#d8eee6"></div></main>';
const flow = 'flowchart LR\n A["Send message"] --> B["Render (HTML)"]\n B --> C{"Closed fence?"}\n C -->|Yes| D["Interactive preview"]';

const samples: Record<string, { text: string; streaming?: boolean }> = {
  mixed: { text: 'Rendered content in a chat message.\n\n' + fence('html', counter) + '\nThe flow below follows the HTML block.\n\n' + fence('mermaid', flow) },
  streaming: { text: 'Closed blocks during an ongoing response.\n\n' + fence('html', counter) + '\n' + fence('mermaid', flow) + '\nThe response is still continuing.', streaming: true },
  unfinishedHtml: { text: 'An unfinished HTML fence.\n\n' + fence('html', '<button onclick="alert(1)">Partial', false), streaming: true },
  unfinishedMermaid: { text: 'An unfinished diagram fence.\n\n' + fence('mermaid', 'flowchart LR\n A --> B', false), streaming: true },
  inline: { text: 'Interactive file-backed visualization.\n\n::newmax-inline-vis{file="counter.html"}' },
  inlineStreaming: { text: 'Interactive file-backed visualization.\n\n::newmax-inline-vis{file="counter.html"}\n\nContinuing reply.', streaming: true },
  html: { text: fence('html', counter) },
  short: { text: fence('html', '<div style="height:24px;background:#d8eee6;color:#153b2d">Short HTML</div>') },
  long: { text: fence('html', '<div style="height:1450px;background:#d8eee6;color:#153b2d;padding:16px">Long HTML<div style="margin-top:1370px">LONG_CONTENT_END</div></div>') },
  multiple: { text: fence('html', '<div style="height:40px">First preview</div>') + '\n' + fence('html', '<div style="height:80px">Second preview</div>') + '\n' + fence('mermaid', flow) + '\n' + fence('mermaid', 'sequenceDiagram\n participant A as User\n participant B as Runtime\n A->>B: Render diagram\n B-->>A: Visible response') },
  mermaid: { text: fence('mermaid', flow) },
  sequence: { text: fence('mermaid', 'sequenceDiagram\n participant A as User\n participant B as Runtime\n A->>B: Render diagram\n B-->>A: Visible response') },
  wideDiagram: { text: fence('mermaid', 'flowchart LR\n A["Start of a long workflow"] --> B["Read the current message"] --> C["Parse complete HTML blocks"] --> D["Start the preview guest"] --> E["Measure dynamic content"] --> F["Display rendered result"]') },
};

function Fixture() {
  const [state, setState] = useState({ sample: 'mixed', theme: 'light', suffix: '', streaming: undefined as boolean | undefined });
  useEffect(() => {
    Object.assign(window, {
      syncThink: { runtime: { readProjectFile: async () => ({ content: counter.replace('<main ', '<main class="viz-root" '), error: null }) } },
      chatEmbedQA: {
        set: (sample: string, theme = 'light') => setState({ sample, theme, suffix: '', streaming: undefined }),
        append: (suffix: string) => setState((previous) => ({ ...previous, suffix: previous.suffix + suffix })),
        finish: () => setState((previous) => ({ ...previous, streaming: false })),
        exportPng: async () => {
          const host = document.querySelector<HTMLElement>('.shell-mermaid__canvas');
          if (!host) return null;
          const svg = getExportSvg(host);
          if (!svg) return null;
          const png = await svgToPngBlob(svg.svg, svg.width, svg.height);
          return { svg, png: png ? Array.from(new Uint8Array(await png.arrayBuffer())) : null };
        },
      },
    });
    document.documentElement.dataset.chatEmbedReady = 'true';
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }, [state.theme]);
  const sample = samples[state.sample] ?? samples.mixed;
  return (
    <div className="shell-chat-message-scroller" style={{ height: '100%', overflowY: 'auto', background: 'var(--color-chat)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 900, margin: '0 auto' }} data-qa-sample={state.sample}>
        <MarkdownContent key={state.sample} text={sample.text + state.suffix} streaming={state.streaming ?? sample.streaming} projectFolder="D:/chat-embeds-fixture" conversationId="qa-only" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
