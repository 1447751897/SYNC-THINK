import * as Dialog from '@radix-ui/react-dialog';
import type { GetBrowserWorkflowResponse } from '@sync-think/protocol';
import { useEffect, useRef, useState } from 'react';

type Job = {
  detail: GetBrowserWorkflowResponse;
  names: string[];
  values: Record<string, string>;
  origins?: string[];
};

/** Start prepared tasks immediately; ask only for required inputs or origin grants. */
export function useBrowserTaskExecution(onChanged: () => void) {
  const locked = useRef(new Set<string>());
  const alive = useRef(true);
  const submitting = useRef(new Set<string>());
  const [pending, setPending] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<Job[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const unlock = (id: string) => {
    locked.current.delete(id);
    if (alive.current) setPending([...locked.current]);
  };
  const enqueue = (job: Job) => {
    if (alive.current) setPrompts((current) => [...current, job]);
  };
  const run = async (job: Job, approve = false) => {
    let needsInput = false;
    const id = job.detail.task.id;
    if (submitting.current.has(id)) return;
    submitting.current.add(id);
    try {
      const api = window.syncThink!.runtime.browserWorkflow;
      const payload = { taskId: id, variables: job.values };
      const promise =
        approve && job.origins?.length
          ? api.approveAndExecute({ ...payload, origins: job.origins })
          : job.detail.version
            ? api.execute(payload)
            : api.executeDraft(payload);
      onChanged();
      const result = await promise;
      if (!alive.current) return;
      if (result.missingVariables?.length) {
        needsInput = true;
        enqueue({ ...job, names: [...new Set([...job.names, ...result.missingVariables])] });
      } else if (result.missingOrigins?.length) {
        needsInput = true;
        enqueue({ ...job, origins: result.missingOrigins });
      } else if (!result.ok) {
        setNotice(
          `「${job.detail.task.name}」执行中断：${(result.error ?? '请检查浏览器页面后重试').split('\n')[0].slice(0, 180)}`,
        );
      }
    } catch {
      if (alive.current)
        setNotice(`「${job.detail.task.name}」执行请求中断，请检查浏览器页面后重试。`);
    } finally {
      submitting.current.delete(id);
      if (!needsInput) unlock(id);
      if (alive.current) onChanged();
    }
  };
  const execute = async (id: string) => {
    if (locked.current.has(id)) return;
    locked.current.add(id);
    setPending([...locked.current]);
    setNotice('');
    try {
      const detail = await window.syncThink!.runtime.browserWorkflow.get({ taskId: id });
      if (!alive.current) {
        unlock(id);
        return;
      }
      const steps = detail.version?.steps ?? detail.draft?.steps ?? [];
      if (!steps.length) {
        setNotice(`「${detail.task.name}」尚未配置操作步骤。`);
        unlock(id);
        return;
      }
      const names = [
        ...new Set(
          steps.flatMap((step) =>
            step.kind === 'fill' && step.value.kind === 'variable' ? [step.value.name] : [],
          ),
        ),
      ];
      const job = { detail, names, values: {} };
      if (names.length) enqueue(job);
      else void run(job);
    } catch {
      unlock(id);
      if (alive.current) setNotice('任务加载失败，请重试。');
    }
  };
  const prompt = prompts[0];
  const dismiss = () => {
    if (prompt) unlock(prompt.detail.task.id);
    setPrompts((current) => current.slice(1));
  };
  const dialog = (
    <Dialog.Root
      open={Boolean(prompt)}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="browser-workflow-dialog__overlay" />
        <Dialog.Content className="browser-workflow-dialog browser-dashboard__run-inputs">
          <Dialog.Title>{prompt?.origins?.length ? '确认访问站点' : '补充执行参数'}</Dialog.Title>
          <Dialog.Description>{prompt?.detail.task.name}</Dialog.Description>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!prompt) return;
              setPrompts((current) => current.slice(1));
              void run(prompt, Boolean(prompt.origins?.length));
            }}
          >
            {prompt?.names.map((name) => (
              <label key={name}>
                {name}
                <input
                  required
                  autoComplete="off"
                  value={prompt.values[name] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPrompts((current) =>
                      current.map((job, index) =>
                        index === 0 ? { ...job, values: { ...job.values, [name]: value } } : job,
                      ),
                    );
                  }}
                />
              </label>
            ))}
            {prompt?.origins?.length ? (
              <>
                <p>此任务需要访问以下站点：</p>
                <ul>
                  {prompt.origins.map((origin) => (
                    <li key={origin}>{origin}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <footer>
              <button type="button" onClick={dismiss}>
                取消
              </button>
              <button
                type="submit"
                disabled={prompt?.names.some((name) => !prompt.values[name]?.trim())}
              >
                {prompt?.origins?.length ? '允许并执行' : '立即执行'}
              </button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
  return { execute, pending, notice, clearNotice: () => setNotice(''), dialog };
}
