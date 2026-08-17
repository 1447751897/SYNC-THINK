/**
 * Brand logo registry for provider catalog entries and kernel badges.
 *
 * Assets come from @lobehub/icons-static-svg (MIT) and are vendored under
 * ./assets/brands so the shell bundle stays offline-safe; esbuild inlines them
 * as data URLs (see scripts/build-shell.mjs `.svg: dataurl`).
 *
 * Two render modes are needed because vendored logos differ in kind:
 * - `mono` logos are authored with `fill="currentColor"`. A data-URL <img> would
 *   paint them black (currentColor does not cross the image boundary), so they
 *   are rendered as a CSS mask tinted with the surrounding text color.
 * - full-color logos carry their own palette and render as a plain <img>.
 *
 * Only brands with a real upstream logo appear here. Providers without one
 * (NewMax Gateway, GPTNB, Pipellm, 百聆, …) intentionally keep the letter glyph
 * fallback rather than an invented mark.
 */
import syncThinkLogo from './assets/sync-think-logo.png';
import anthropicLogo from './assets/brands/anthropic.svg';
import antigravityLogo from './assets/brands/antigravity-color.svg';
import bailianLogo from './assets/brands/bailian-color.svg';
import chatgptLogo from './assets/brands/chatgpt.svg';
import claudeCodeLogo from './assets/brands/claudecode-color.svg';
import deepseekLogo from './assets/brands/deepseek-color.svg';
import geminiLogo from './assets/brands/gemini-color.svg';
import grokLogo from './assets/brands/grok.svg';
import kimiLogo from './assets/brands/kimi-color.svg';
import lmStudioLogo from './assets/brands/lmstudio.svg';
import longcatLogo from './assets/brands/longcat-color.svg';
import minimaxLogo from './assets/brands/minimax-color.svg';
import modelScopeLogo from './assets/brands/modelscope-color.svg';
import moonshotLogo from './assets/brands/moonshot.svg';
import ollamaLogo from './assets/brands/ollama.svg';
import openaiLogo from './assets/brands/openai.svg';
import openCodeLogo from './assets/brands/opencode.svg';
import openRouterLogo from './assets/brands/openrouter-color.svg';
import piLogo from './assets/brands/pi.svg';
import siliconCloudLogo from './assets/brands/siliconcloud-color.svg';
import stepfunLogo from './assets/brands/stepfun-color.svg';
import volcengineLogo from './assets/brands/volcengine-color.svg';
import xiaomiMiMoLogo from './assets/brands/xiaomimimo.svg';
import zaiLogo from './assets/brands/zai.svg';
import zhipuLogo from './assets/brands/zhipu-color.svg';

export interface BrandLogo {
  /** Inlined data URL of the vendored SVG. */
  src: string;
  /** true when the asset uses `currentColor` and must be tinted via CSS mask. */
  mono: boolean;
  /** Accessible brand label (used for img alt / aria-label). */
  label: string;
}

const logo = (src: string, label: string, mono: boolean): BrandLogo => ({ src, label, mono });

/** Provider catalog item id → upstream brand logo. */
export const PROVIDER_BRAND_LOGOS: Readonly<Record<string, BrandLogo>> = {
  // 国内服务
  'minimax-cn': logo(minimaxLogo, 'MiniMax', false),
  'kimi-coding': logo(kimiLogo, 'Kimi', false),
  moonshot: logo(moonshotLogo, 'Moonshot AI', true),
  zhipu: logo(zhipuLogo, '智谱', false),
  deepseek: logo(deepseekLogo, 'DeepSeek', false),
  'bailian-coding': logo(bailianLogo, '阿里云百炼', false),
  stepfun: logo(stepfunLogo, '阶跃星辰', false),
  longcat: logo(longcatLogo, 'LongCat', true),
  'xiaomi-mimo': logo(xiaomiMiMoLogo, '小米 MiMo', true),
  'volcengine-ark': logo(volcengineLogo, '火山方舟', false),
  'siliconflow-cn': logo(siliconCloudLogo, '硅基流动', false),
  modelscope: logo(modelScopeLogo, 'ModelScope', false),
  // 聚合平台
  'anthropic-gateway': logo(anthropicLogo, 'Anthropic', true),
  // 海外平台
  openai: logo(openaiLogo, 'OpenAI', true),
  'chatgpt-subscription': logo(openaiLogo, 'OpenAI', true),
  supergrok: logo(grokLogo, 'Grok', true),
  antigravity: logo(antigravityLogo, 'Antigravity', false),
  'gemini-api': logo(geminiLogo, 'Google Gemini', false),
  'opencode-go': logo(openCodeLogo, 'opencode', true),
  'opencode-go-anthropic': logo(openCodeLogo, 'opencode', true),
  anthropic: logo(anthropicLogo, 'Anthropic', true),
  'minimax-global': logo(minimaxLogo, 'MiniMax', false),
  'z-ai': logo(zaiLogo, 'Z.ai', true),
  openrouter: logo(openRouterLogo, 'OpenRouter', false),
  'siliconflow-global': logo(siliconCloudLogo, 'SiliconFlow', false),
  // 本地模型
  ollama: logo(ollamaLogo, 'Ollama', true),
  'lm-studio': logo(lmStudioLogo, 'LM Studio', true),
};

/**
 * Kernel `icon` asset key → the kernel's own brand mark. Each kernel shows its
 * own product logo (Claude Code → Claude Code, Codex → ChatGPT), not the parent
 * company's; `native` has no third-party brand and keeps a lucide glyph.
 */
export const KERNEL_BRAND_LOGOS: Readonly<Record<string, BrandLogo>> = {
  native: logo(syncThinkLogo, 'Sync-Think', false),
  'claude-code': logo(claudeCodeLogo, 'Claude Code', false),
  codex: logo(chatgptLogo, 'ChatGPT', false),
  pi: logo(piLogo, 'Pi', true),
};

export function resolveProviderBrandLogo(providerId: string): BrandLogo | undefined {
  return PROVIDER_BRAND_LOGOS[providerId];
}

/**
 * Fallback lookup for providers the user added themselves: their providerId is
 * a random ULID, so it can never match the preset catalog keys. Match the
 * provider's display name against known brands instead. Order matters — the
 * first matching rule wins; `undefined` intentionally keeps the letter glyph
 * for relay services without an official logo (e.g. KMKAPI).
 */
const PROVIDER_BRAND_BY_NAME: ReadonlyArray<readonly [RegExp, string | undefined]> = [
  // Relay services without their own brand must be matched first so their
  // model-family names (e.g. KMKAPI-GROK) do not collide with the real brand.
  [/kamenking|kmkapi|kamen/i, undefined],
  [/deepseek/i, 'deepseek'],
  [/zhipu|智谱/i, 'zhipu'],
  [/kimi|moonshot/i, 'kimi-coding'],
  [/qwen|bailian|百炼|aliyun|阿里/i, 'bailian-coding'],
  [/gemini|google/i, 'gemini-api'],
  [/grok/i, 'supergrok'],
  [/openai/i, 'openai'],
  [/anthropic|claude/i, 'anthropic'],
  [/minimax/i, 'minimax-cn'],
  [/siliconflow|硅基/i, 'siliconflow-cn'],
  [/volcengine|火山|doubao|豆包/i, 'volcengine-ark'],
  [/modelscope|魔搭/i, 'modelscope'],
  [/stepfun|阶跃/i, 'stepfun'],
  [/longcat/i, 'longcat'],
  [/xiaomi|mimo/i, 'xiaomi-mimo'],
  [/ollama/i, 'ollama'],
  [/lm\s*studio/i, 'lm-studio'],
  [/openrouter/i, 'openrouter'],
  [/z\.?ai/i, 'z-ai'],
  [/antigravity/i, 'antigravity'],
  [/opencode/i, 'opencode-go'],
];

export function resolveProviderBrandLogoByName(providerName: string): BrandLogo | undefined {
  const name = providerName.trim();
  if (!name) return undefined;
  for (const [pattern, brandId] of PROVIDER_BRAND_BY_NAME) {
    if (pattern.test(name)) {
      return brandId ? PROVIDER_BRAND_LOGOS[brandId] : undefined;
    }
  }
  return undefined;
}

export function resolveKernelBrandLogo(iconKey: string): BrandLogo | undefined {
  return KERNEL_BRAND_LOGOS[iconKey];
}
