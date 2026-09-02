import { AlertTriangle, Download, PanelsTopLeft } from 'lucide-react';
import { UiDesignSurface } from '@sync-think/ui-kit';
import { parseUiDesignJson } from '@sync-think/protocol/ui-design';

export function UiDesignPreview({ code }: { code: string }) {
  const artifact = parseUiDesignJson(code);
  if (!artifact) {
    return <section className="shell-design-draft-invalid" role="alert" data-testid="ui-design-invalid">
      <div className="shell-design-draft-invalid__title"><PanelsTopLeft size={14} aria-hidden="true" /><span>设计稿</span></div>
      <div className="shell-design-draft-invalid__message"><AlertTriangle size={15} aria-hidden="true" /><span>UI 设计资源格式无效，请让模型重新生成</span></div>
    </section>;
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ui-design.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return <div className="shell-ui-design-preview" data-testid="ui-design-preview">
    <div className="shell-ui-design-preview__bar"><span><PanelsTopLeft size={13} aria-hidden="true" />设计稿</span><button type="button" onClick={download} title="下载 UI 设计资源"><Download size={13} aria-hidden="true" />下载</button></div>
    <UiDesignSurface artifact={artifact} />
  </div>;
}
