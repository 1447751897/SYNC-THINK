import * as Dialog from '@radix-ui/react-dialog';
import type {
  BrowserAutomationTaskSummary,
  GetBrowserWorkflowResponse,
} from '@sync-think/protocol';
import type { BrowserRecordingStepInput } from '@sync-think/shared';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function browserTaskStepLabel(step: BrowserRecordingStepInput): string {
  switch (step.kind) {
    case 'navigate':
      return `打开 ${step.url}`;
    case 'click':
      return '点击页面元素';
    case 'fill':
      return step.value.kind === 'variable' ? `填写 ${step.value.name}` : '填写输入内容';
    case 'select':
      return '选择选项';
    case 'check':
      return '设置勾选状态';
    case 'press':
      return '按下键盘按键';
    default:
      return '执行页面操作';
  }
}

export function BrowserTaskInfo(props: {
  task: BrowserAutomationTaskSummary;
  profileName: string;
  workspaceName: string;
  onClose(): void;
}): JSX.Element {
  const [detail, setDetail] = useState<GetBrowserWorkflowResponse>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const previousFocus = useRef(document.activeElement);
  useEffect(() => {
    let disposed = false;
    setDetail(undefined);
    setError('');
    void window
      .syncThink!.runtime.browserWorkflow.get({ taskId: props.task.id })
      .then((result) => {
        if (!disposed) setDetail(result);
      })
      .catch(() => {
        if (!disposed) setError('任务信息加载失败');
      });
    return () => {
      disposed = true;
    };
  }, [props.task.id, revision]);
  const steps = detail?.version?.steps ?? detail?.draft?.steps ?? [];
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="browser-workflow-dialog__overlay" />
        <Dialog.Content
          className="browser-dashboard__info"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const previous = previousFocus.current;
            if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
          }}
        >
          <header>
            <div>
              <Dialog.Title>{props.task.name}</Dialog.Title>
              <Dialog.Description>任务信息</Dialog.Description>
            </div>
            <Dialog.Close aria-label="关闭任务信息">
              <X size={16} />
            </Dialog.Close>
          </header>
          <dl>
            <dt>目标网址</dt>
            <dd>{props.task.startUrl}</dd>
            <dt>浏览器环境</dt>
            <dd>{props.profileName}</dd>
            <dt>所属工作区</dt>
            <dd>{props.workspaceName}</dd>
            <dt>执行时间</dt>
            <dd>
              {detail
                ? detail.schedule?.enabled
                  ? `每 ${detail.schedule.intervalMinutes} 分钟`
                  : '手动执行'
                : error
                  ? '—'
                  : '加载中…'}
            </dd>
          </dl>
          <section>
            <h3>任务说明</h3>
            <p>{props.task.instruction}</p>
          </section>
          <section>
            <h3>操作步骤</h3>
            {error ? (
              <p role="alert">
                {error} <button onClick={() => setRevision((value) => value + 1)}>重试</button>
              </p>
            ) : !detail ? (
              <p>加载中…</p>
            ) : steps.length ? (
              <ol>
                {steps.map((step, index) => (
                  <li key={index}>{browserTaskStepLabel(step)}</li>
                ))}
              </ol>
            ) : (
              <p>尚未配置操作步骤</p>
            )}
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
