/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { McpIdentityMark } from './McpIdentityMark.js';

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

it('remembers a working remote favicon source across mounts', () => {
  const props = { name: 'My Custom MCP', endpoint: 'https://mcp.example.org/mcp' };
  const first = render(<McpIdentityMark {...props} />);
  const original = screen.getByTestId('mcp-icon-mcp.example.org') as HTMLImageElement;
  expect(original.getAttribute('src')).toBe('https://mcp.example.org/favicon.ico');
  fireEvent.error(original);
  const fallback = screen.getByTestId('mcp-icon-mcp.example.org') as HTMLImageElement;
  expect(fallback.getAttribute('src')).toContain('google.com/s2/favicons');
  fireEvent.load(fallback);
  first.unmount();
  render(<McpIdentityMark {...props} />);
  expect((screen.getByTestId('mcp-icon-mcp.example.org') as HTMLImageElement).getAttribute('src'))
    .toBe(fallback.getAttribute('src'));
});


it('keeps the semantic fallback after all remote favicons fail', () => {
  const props = { name: 'Unbranded MCP', endpoint: 'https://unknown.example.net/mcp' };
  const first = render(<McpIdentityMark {...props} />);
  fireEvent.error(screen.getByTestId('mcp-icon-unknown.example.net'));
  fireEvent.error(screen.getByTestId('mcp-icon-unknown.example.net'));
  expect(screen.getByTestId('mcp-icon-unknown.example.net').tagName).toBe('svg');
  first.unmount();
  render(<McpIdentityMark {...props} />);
  expect(screen.getByTestId('mcp-icon-unknown.example.net').tagName).toBe('svg');
});
