export function keepListboxOptionVisible(container: HTMLElement | null, index: number): void {
  if (!container || index < 0) return;
  const option = container.querySelectorAll<HTMLElement>('[role="option"]')[index];
  if (!option || container.clientHeight <= 0) return;

  const viewportTop = container.scrollTop;
  const viewportBottom = viewportTop + container.clientHeight;
  const optionTop = option.offsetTop;
  const optionBottom = optionTop + option.offsetHeight;

  if (optionTop < viewportTop) {
    container.scrollTop = optionTop;
  } else if (optionBottom > viewportBottom) {
    container.scrollTop = optionBottom - container.clientHeight;
  }
}
