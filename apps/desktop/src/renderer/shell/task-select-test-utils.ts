import { fireEvent, screen } from '@testing-library/react';
/** Interact through the real custom menu, with native inputs left unchanged. */
export function changeTaskControl(element: Element, event: { target: { value: unknown } }) {
  if (element.getAttribute('role') !== 'combobox') {
    fireEvent.change(element, event);
    return;
  }
  for (const menu of screen.queryAllByRole('menu')) fireEvent.keyDown(menu, { key: 'Escape' });
  fireEvent.keyDown(element, { key: 'ArrowDown', code: 'ArrowDown' });
  const menu = screen.getByRole('menu');
  const item = [...menu.querySelectorAll('[role="menuitemradio"]')].find(
    (option) => option.getAttribute('data-value') === String(event.target.value),
  );
  if (!item) throw new Error('Choice not available: ' + event.target.value);
  fireEvent.click(item);
}
export function taskOption(name: string | RegExp, control: string) {
  for (const menu of screen.queryAllByRole('menu')) fireEvent.keyDown(menu, { key: 'Escape' });
  fireEvent.keyDown(screen.getByLabelText(control), { key: 'ArrowDown', code: 'ArrowDown' });
  return screen.getByRole('menuitemradio', { name });
}
export function closeTaskMenu() {
  for (const menu of screen.queryAllByRole('menu')) fireEvent.keyDown(menu, { key: 'Escape' });
}
