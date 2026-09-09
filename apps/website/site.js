import { authRequest } from './auth-client.js';

for (const link of document.querySelectorAll('.mobile-nav a')) {
  link.addEventListener('click', () => {
    document.querySelector('.mobile-nav').open = false;
  });
}
document.getElementById('copy-embed').addEventListener('click', async () => {
  const snippet = `<iframe src="${location.origin}/demo" title="SYNC-THINK 工作台交互演示" width="100%" height="700" loading="lazy" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" style="border:0"></iframe>`;
  const code = document.getElementById('embed-code');
  code.value = snippet;
  try {
    await navigator.clipboard.writeText(snippet);
    code.hidden = true;
    document.getElementById('embed-status').textContent =
      '嵌入代码已复制。目标网站需先开通嵌入权限。';
  } catch {
    code.hidden = false;
    code.focus();
    code.select();
    document.getElementById('embed-status').textContent =
      '请选择下方代码复制。目标网站需先开通嵌入权限。';
  }
});

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  for (const [index, element] of [
    ...document.querySelectorAll('.hero h1, .hero-tagline, .hero-description, .hero-actions'),
  ].entries()) {
    element.animate(
      [
        { opacity: 0, transform: 'translateY(18px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: 720,
        delay: index * 90,
        easing: 'cubic-bezier(.16,1,.3,1)',
        fill: 'backwards',
      },
    );
  }
}
// Homepage content remains usable during an account-service interruption.
try {
  const session = await authRequest('get-session');
  if (session?.user) {
    for (const link of document.querySelectorAll('[data-account-link]')) {
      link.href = '/account';
      link.textContent = '我的账号';
    }
  }
} catch {
  // The login page owns recoverable account-service errors.
}
