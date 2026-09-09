import { authRequest, validatePassword } from './auth-client.js';

const el = (id) => document.getElementById(id);
const views = {
  '/login': {
    title: '登录 SYNC-THINK',
    description: '继续使用你的云端账号。',
    submit: '登录',
    switchLabel: '还没有账号？',
    switchText: '创建账号',
    switchPath: '/register',
  },
  '/register': {
    title: '创建你的账号',
    description: '从这里，开始连接你的工作。',
    submit: '创建账号',
    switchLabel: '已有账号？',
    switchText: '登录',
    switchPath: '/login',
  },
  '/forgot-password': {
    title: '找回密码',
    description: '我们会向你的邮箱发送重设密码的链接。',
    submit: '发送重设邮件',
    switchLabel: '想起密码了？',
    switchText: '返回登录',
    switchPath: '/login',
  },
  '/reset-password': {
    title: '设置新密码',
    description: '使用 12 到 128 个字符设置新密码。',
    submit: '保存新密码',
    switchLabel: '链接过期了？',
    switchText: '重新申请',
    switchPath: '/forgot-password',
  },
};
const route = location.pathname.replace(/\/$/, '') || '/login';
const query = new URLSearchParams(location.search);
let config;
let initialized = false;
let pending = false;
let resetToken = query.get('token') || new URLSearchParams(location.hash.slice(1)).get('token');
// Fragments survive a refresh without sending the reset token to the server again.
if (resetToken)
  history.replaceState(null, '', `${location.pathname}#token=${encodeURIComponent(resetToken)}`);

function notice(message, error = false) {
  const target = el(error ? 'auth-error' : 'auth-notice');
  target.textContent = message;
  target.hidden = false;
}
function clearNotices() {
  el('auth-error').hidden = true;
  el('auth-notice').hidden = true;
}
function setPending(value) {
  pending = value;
  el('auth-form').setAttribute('aria-busy', String(value));
  el('submit-button').disabled = value;
  el('resend-verification').disabled = value;
  el('submit-button').textContent = value ? '正在提交…' : views[route]?.submit || '提交';
}
function showSwitch(view) {
  el('auth-switch').hidden = false;
  el('switch-label').textContent = view.switchLabel;
  el('switch-link').textContent = view.switchText;
  el('switch-link').href = view.switchPath;
}
async function initialize() {
  clearNotices();
  el('retry').hidden = true;
  try {
    const response = await fetch('/api/config', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('账号服务暂时中断，请稍后重试。');
    config = await response.json();
    const session = await authRequest('get-session');
    if (route === '/account') {
      if (!session?.user) {
        location.replace('/login');
        return;
      }
      el('auth-title').textContent = '你的账号';
      document.title = '你的账号 | SYNC-THINK';
      el('auth-description').textContent = '欢迎回来。';
      el('account-name').textContent = session.user.name;
      el('account-email').textContent = session.user.email;
      el('account-verified').textContent = session.user.emailVerified ? '已验证' : '待验证';
      el('account-details').hidden = false;
      return;
    }
    if (session?.user && (route === '/login' || route === '/register')) {
      location.replace('/account');
      return;
    }
    const view = views[route] || views['/login'];
    document.title = `${view.title} | SYNC-THINK`;
    el('auth-title').textContent = view.title;
    el('auth-description').textContent = view.description;
    showSwitch(view);
    const registration = route === '/register';
    const reset = route === '/reset-password';
    const forgot = route === '/forgot-password';
    el('name-field').hidden = !registration;
    el('name').required = registration;
    el('name').disabled = !registration;
    el('email-field').hidden = reset;
    el('email').disabled = reset;
    el('email').required = !reset;
    el('password-field').hidden = forgot;
    el('password').disabled = forgot;
    el('password').required = !forgot;
    el('password').minLength = registration || reset ? 12 : 1;
    el('password').autocomplete = registration || reset ? 'new-password' : 'current-password';
    el('password-label').textContent = registration || reset ? '密码（12–128 个字符）' : '密码';
    el('forgot-link').hidden = registration || reset;
    el('submit-button').textContent = view.submit;
    if (registration && !config.registrationEnabled) {
      notice('当前暂未开放新账号注册。已有账号可继续登录。');
      return;
    }
    if (forgot && !config.emailEnabled) {
      notice('邮件服务尚未启用，请稍后再试。');
      return;
    }
    if (reset && (!resetToken || query.has('error'))) {
      notice('重设链接已失效，请重新申请邮件。', true);
      return;
    }
    if (query.has('error')) {
      notice('验证链接已失效。输入邮箱后，可重新发送验证邮件。', true);
      el('resend-verification').hidden = !config.emailEnabled;
    } else if (query.get('verified') === '1') notice('邮箱已验证，请登录。');
    else if (query.get('reset') === '1') notice('密码已更新，请使用新密码登录。');
    el('auth-form').hidden = false;
    initialized = true;
  } catch (error) {
    notice(
      error instanceof TypeError || error.name === 'TimeoutError'
        ? '连接中断，请检查网络后重试。'
        : error.message,
      true,
    );
    el('retry').hidden = false;
    el('auth-description').textContent = '账号服务连接暂时中断。';
  }
}

el('show-password').addEventListener('change', (event) => {
  el('password').type = event.target.checked ? 'text' : 'password';
});
el('retry').addEventListener('click', initialize);
el('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (pending || !initialized) return;
  clearNotices();
  const email = el('email').value.trim();
  const password = el('password').value;
  if ((route === '/register' || route === '/reset-password') && !validatePassword(password)) {
    notice('密码需要 12 到 128 个字符。', true);
    return;
  }
  setPending(true);
  try {
    if (route === '/register') {
      const name = el('name').value.trim();
      if (!name) {
        notice('请输入你的称呼。', true);
        return;
      }
      await authRequest('sign-up/email', {
        name,
        email,
        password,
        callbackURL: '/login?verified=1',
      });
      el('password').value = '';
      el('auth-form').hidden = true;
      notice('注册请求已提交。请查看邮箱中的验证邮件；已有账号可直接登录。');
      el('resend-verification').hidden = !config.emailEnabled;
    } else if (route === '/forgot-password') {
      await authRequest('request-password-reset', { email, redirectTo: '/reset-password' });
      el('auth-form').hidden = true;
      notice('若该邮箱已注册，你将收到重设邮件。请同时检查垃圾邮件文件夹。');
    } else if (route === '/reset-password') {
      await authRequest('reset-password', { newPassword: password, token: resetToken });
      resetToken = null;
      el('password').value = '';
      location.replace('/login?reset=1');
    } else {
      await authRequest('sign-in/email', {
        email,
        password,
        rememberMe: false,
        callbackURL: '/account',
      });
      el('password').value = '';
      location.replace('/account');
    }
  } catch (error) {
    notice(error.message, true);
    if (error.code === 'EMAIL_NOT_VERIFIED')
      el('resend-verification').hidden = !config.emailEnabled;
  } finally {
    setPending(false);
  }
});
el('resend-verification').addEventListener('click', async () => {
  if (pending || !el('email').validity.valid) return;
  setPending(true);
  clearNotices();
  try {
    await authRequest('send-verification-email', {
      email: el('email').value.trim(),
      callbackURL: '/login?verified=1',
    });
    notice('验证邮件请求已提交，请查看收件箱与垃圾邮件文件夹。');
  } catch (error) {
    notice(error.message, true);
  } finally {
    setPending(false);
  }
});
el('sign-out').addEventListener('click', async () => {
  el('sign-out').disabled = true;
  try {
    await authRequest('sign-out', {});
    location.replace('/login');
  } catch (error) {
    notice(error.message, true);
    el('sign-out').disabled = false;
  }
});
initialize();
