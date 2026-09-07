const endpoints = new Set([
  'sign-in/email',
  'sign-up/email',
  'get-session',
  'sign-out',
  'request-password-reset',
  'reset-password',
  'send-verification-email',
]);

export function authErrorMessage(code, status) {
  if (status === 429) return '操作太频繁，请稍后再试。';
  const messages = {
    INVALID_EMAIL_OR_PASSWORD: '邮箱或密码有误，请重新输入。',
    EMAIL_NOT_VERIFIED: '请先打开验证邮件，完成邮箱验证。',
    USER_ALREADY_EXISTS: '请尝试登录，或通过邮件重设密码。',
    USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '请尝试登录，或通过邮件重设密码。',
    INVALID_TOKEN: '链接已失效，请重新申请邮件。',
    TOKEN_EXPIRED: '链接已过期，请重新申请邮件。',
    PASSWORD_TOO_SHORT: '密码至少需要 12 个字符。',
    PASSWORD_TOO_LONG: '密码请保持在 128 个字符以内。',
    SIGNUP_DISABLED: '当前暂未开放新账号注册。',
    REGISTRATION_DISABLED: '当前暂未开放新账号注册。',
    EMAIL_DISABLED: '邮件服务尚未启用，请稍后再试。',
    EMAIL_NOT_CONFIGURED: '邮件服务尚未启用，请稍后再试。',
    AUTH_NOT_CONFIGURED: '云端账号服务尚未启用，请稍后再试。',
    MAIL_UNAVAILABLE: '邮件服务暂时中断，请稍后再试。',
  };
  return (
    messages[code] ||
    (status >= 500 ? '账号服务暂时中断，请稍后重试。' : '操作未完成，请检查输入后重试。')
  );
}

export function validatePassword(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

export async function authRequest(endpoint, body, request = globalThis.fetch) {
  if (!endpoints.has(endpoint)) throw new Error('Invalid auth endpoint');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await request(`/api/auth/${endpoint}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(authErrorMessage(data?.code, response.status));
      error.code = data?.code;
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error instanceof TypeError || error.name === 'AbortError') {
      throw new Error('连接中断，请检查网络后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
