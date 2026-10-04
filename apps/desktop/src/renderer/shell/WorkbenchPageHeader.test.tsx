/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkbenchPageHeader } from './WorkbenchPageHeader.js';
afterEach(cleanup);
describe('WorkbenchPageHeader', () => {
  it('keeps page identity and actions in the shared header', () => {
    render(
      <WorkbenchPageHeader
        className="page-specific"
        heading={
          <>
            <h1>收件箱</h1>
            <p>任务执行结果</p>
          </>
        }
        actions={<button type="button">新建</button>}
      />,
    );
    const header = screen.getByRole('banner');
    expect(header.className).toContain('workbench-page__header');
    expect(header.className).toContain('page-specific');
    expect(header.contains(screen.getByRole('heading', { name: '收件箱' }))).toBe(true);
    expect(header.contains(screen.getByRole('button', { name: '新建' }))).toBe(true);
  });
  it('does not add an empty actions container', () => {
    const { container } = render(<WorkbenchPageHeader heading={<h1>小队库</h1>} />);
    expect(container.querySelector('.workbench-page__actions')).toBeNull();
  });
});
