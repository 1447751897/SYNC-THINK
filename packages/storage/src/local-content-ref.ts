const WINDOWS_ABSOLUTE_PATH_REGEX = /^[a-z]:[\\/]/i;
const UNC_ABSOLUTE_PATH_REGEX = /^\\\\[^\\/]+[\\/][^\\/]+/;
const INTERNAL_ARTIFACT_REF_REGEX = /^artifact:\/\/[a-z0-9][a-z0-9._:/-]{0,1023}$/i;

export const MAX_LOCAL_CONTENT_REF_LENGTH = 4096;

export function isLocalContentRef(value: string): boolean {
  if (
    !value ||
    value.trim() !== value ||
    value.length > MAX_LOCAL_CONTENT_REF_LENGTH ||
    [...value].some((character) => {
      const codePoint = character.charCodeAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return false;
  }
  if (
    WINDOWS_ABSOLUTE_PATH_REGEX.test(value) ||
    UNC_ABSOLUTE_PATH_REGEX.test(value) ||
    (value.startsWith('/') && !value.startsWith('//')) ||
    INTERNAL_ARTIFACT_REF_REGEX.test(value)
  ) {
    return true;
  }
  if (!value.toLowerCase().startsWith('file://')) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'file:' &&
      (parsed.hostname === '' || parsed.hostname === 'localhost') &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname.startsWith('/') &&
      parsed.search === '' &&
      parsed.hash === ''
    );
  } catch {
    return false;
  }
}
