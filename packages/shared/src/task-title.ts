const UNTITLED_TASK_PATTERN = /^(?:新任务|子任务)(?:\s+\d+)?$/;

export function isUntitledTaskTitle(value: string | null | undefined): boolean {
  return UNTITLED_TASK_PATTERN.test((value ?? '').trim());
}

export function deriveTaskTitleFromPrompt(prompt: string, maxLength = 32): string {
  const safeMaxLength = Math.max(8, Math.floor(maxLength));
  const lines = prompt
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s*)/, ''))
    .filter(Boolean);

  let title = lines[0] ?? '';
  if (/[:：]$/.test(title) && lines[1]) title = `${title}${lines[1]}`;
  title = title
    .replace(/^(?:请(?:你)?|麻烦(?:你)?|能否|可以)\s*/u, '')
    .replace(/^(?:帮我|协助我|为我)\s*/u, '')
    .split(/[。！？!?\n]/u)[0]!
    .replace(/[，,；;：:\s]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) return '新任务';
  const characters = Array.from(title);
  if (characters.length <= safeMaxLength) return title;
  return `${characters.slice(0, safeMaxLength - 1).join('')}…`;
}
