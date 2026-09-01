/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import {
  PromptEnhancementAction,
  usePromptEnhancement,
  type PromptEnhancementModelOption,
} from './prompt-enhancement.js';

const models: PromptEnhancementModelOption[] = [
  { modelId: 'model-current' },
  { modelId: 'model-enhance' },
];

function Harness(props: {
  initialValue?: string;
  enabled?: boolean;
  configuredModelId?: string | null;
}) {
  const [value, setValue] = useState(props.initialValue ?? '写一个发布计划');
  const enhancement = usePromptEnhancement({
    value,
    onValueChange: setValue,
    enabled: props.enabled ?? true,
    configuredModelId: props.configuredModelId ?? 'model-enhance',
    currentModelId: 'model-current',
    models,
  });
  return (
    <div>
      <textarea
        aria-label="草稿"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <PromptEnhancementAction enhancement={enhancement} testId="enhance-action" />
    </div>
  );
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'syncThink');
});

describe('prompt enhancement composer control', () => {
  it('uses the configured model and replaces the captured draft with the provider result', async () => {
    const enhancePrompt = vi.fn().mockResolvedValue({
      requestId: 'request-from-ui',
      text: '请制定一份包含里程碑、风险与验收标准的发布计划。',
      modelId: 'model-enhance',
    });
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { enhancePrompt, cancelPromptEnhancement: vi.fn() } },
    });

    render(<Harness />);
    fireEvent.click(screen.getByTestId('enhance-action'));

    await waitFor(() =>
      expect(screen.getByLabelText('草稿')).toHaveProperty(
        'value',
        '请制定一份包含里程碑、风险与验收标准的发布计划。',
      ),
    );
    expect(enhancePrompt).toHaveBeenCalledTimes(1);
    expect(enhancePrompt.mock.calls[0]?.[0]).toMatchObject({
      text: '写一个发布计划',
      modelId: 'model-enhance',
    });
    expect(enhancePrompt.mock.calls[0]?.[0]?.requestId).toEqual(expect.any(String));
  });

  it('shows a live status while enhancing and surfaces provider errors in the composer', async () => {
    let resolveEnhance: ((value: { requestId: string; text: string; modelId: string }) => void) | undefined;
    const enhancePrompt = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveEnhance = resolve;
        }),
    );
    Object.defineProperty(window, 'syncThink', {
      configurable: true,
      value: { runtime: { enhancePrompt, cancelPromptEnhancement: vi.fn() } },
    });

    render(<Harness />);
    fireEvent.click(screen.getByTestId('enhance-action'));

    expect(screen.getByRole('status').textContent).toBe('正在优化提示词');
    expect(screen.getByTestId('enhance-action').getAttribute('data-busy')).toBe('1');

    resolveEnhance?.({
      requestId: 'request-from-ui',
      text: '',
      modelId: 'model-enhance',
    });

    expect((await screen.findByRole('alert')).textContent).toBe('模型没有返回有效的优化结果');
  });
});
