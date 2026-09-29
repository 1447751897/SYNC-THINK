import { e as edition, n as normalizeColorThemeId, D as DEFAULT_PRESET_IMAGE_THEME_ID, i as instance, t as fallbackImageThemeId, m as resolveImageThemeFocalPoint } from "./globals-tZIWgBuA.js";
import { r as resolveAppLanguage } from "./i18nLanguage-e6qLHGeF.js";
import { c as create } from "./react-BHBINciJ.js";
const subscribeWithSelectorImpl = (fn) => (set, get, api) => {
  const origSubscribe = api.subscribe;
  api.subscribe = (selector, optListener, options) => {
    let listener = selector;
    if (optListener) {
      const equalityFn = (options == null ? void 0 : options.equalityFn) || Object.is;
      let currentSlice = selector(api.getState());
      listener = (state) => {
        const nextSlice = selector(state);
        if (!equalityFn(currentSlice, nextSlice)) {
          const previousSlice = currentSlice;
          optListener(currentSlice = nextSlice, previousSlice);
        }
      };
      if (options == null ? void 0 : options.fireImmediately) {
        optListener(currentSlice, currentSlice);
      }
    }
    return origSubscribe(listener);
  };
  const initialState = fn(set, get, api);
  return initialState;
};
const subscribeWithSelector = subscribeWithSelectorImpl;
function createJSONStorage(getStorage, options) {
  let storage;
  try {
    storage = getStorage();
  } catch (e) {
    return;
  }
  const persistStorage = {
    getItem: (name) => {
      var _a;
      const parse = (str2) => {
        if (str2 === null) {
          return null;
        }
        return JSON.parse(str2, void 0);
      };
      const str = (_a = storage.getItem(name)) != null ? _a : null;
      if (str instanceof Promise) {
        return str.then(parse);
      }
      return parse(str);
    },
    setItem: (name, newValue) => storage.setItem(name, JSON.stringify(newValue, void 0)),
    removeItem: (name) => storage.removeItem(name)
  };
  return persistStorage;
}
const toThenable = (fn) => (input) => {
  try {
    const result = fn(input);
    if (result instanceof Promise) {
      return result;
    }
    return {
      then(onFulfilled) {
        return toThenable(onFulfilled)(result);
      },
      catch(_onRejected) {
        return this;
      }
    };
  } catch (e) {
    return {
      then(_onFulfilled) {
        return this;
      },
      catch(onRejected) {
        return toThenable(onRejected)(e);
      }
    };
  }
};
const persistImpl = (config, baseOptions) => (set, get, api) => {
  let options = {
    storage: createJSONStorage(() => window.localStorage),
    partialize: (state) => state,
    version: 0,
    merge: (persistedState, currentState) => ({
      ...currentState,
      ...persistedState
    }),
    ...baseOptions
  };
  let hasHydrated = false;
  let hydrationVersion = 0;
  const hydrationListeners = /* @__PURE__ */ new Set();
  const finishHydrationListeners = /* @__PURE__ */ new Set();
  let storage = options.storage;
  if (!storage) {
    return config(
      (...args) => {
        console.warn(
          `[zustand persist middleware] Unable to update item '${options.name}', the given storage is currently unavailable.`
        );
        set(...args);
      },
      get,
      api
    );
  }
  const setItem = () => {
    const state = options.partialize({ ...get() });
    return storage.setItem(options.name, {
      state,
      version: options.version
    });
  };
  const savedSetState = api.setState;
  api.setState = (state, replace) => {
    savedSetState(state, replace);
    return setItem();
  };
  const configResult = config(
    (...args) => {
      set(...args);
      return setItem();
    },
    get,
    api
  );
  api.getInitialState = () => configResult;
  let stateFromStorage;
  const hydrate = () => {
    var _a, _b;
    if (!storage) return;
    const currentVersion = ++hydrationVersion;
    hasHydrated = false;
    hydrationListeners.forEach((cb) => {
      var _a2;
      return cb((_a2 = get()) != null ? _a2 : configResult);
    });
    const postRehydrationCallback = ((_b = options.onRehydrateStorage) == null ? void 0 : _b.call(options, (_a = get()) != null ? _a : configResult)) || void 0;
    return toThenable(storage.getItem.bind(storage))(options.name).then((deserializedStorageValue) => {
      if (deserializedStorageValue) {
        if (typeof deserializedStorageValue.version === "number" && deserializedStorageValue.version !== options.version) {
          if (options.migrate) {
            const migration = options.migrate(
              deserializedStorageValue.state,
              deserializedStorageValue.version
            );
            if (migration instanceof Promise) {
              return migration.then((result) => [true, result]);
            }
            return [true, migration];
          }
          console.error(
            `State loaded from storage couldn't be migrated since no migrate function was provided`
          );
        } else {
          return [false, deserializedStorageValue.state];
        }
      }
      return [false, void 0];
    }).then((migrationResult) => {
      var _a2;
      if (currentVersion !== hydrationVersion) {
        return;
      }
      const [migrated, migratedState] = migrationResult;
      stateFromStorage = options.merge(
        migratedState,
        (_a2 = get()) != null ? _a2 : configResult
      );
      set(stateFromStorage, true);
      if (migrated) {
        return setItem();
      }
    }).then(() => {
      if (currentVersion !== hydrationVersion) {
        return;
      }
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(get(), void 0);
      stateFromStorage = get();
      hasHydrated = true;
      finishHydrationListeners.forEach((cb) => cb(stateFromStorage));
    }).catch((e) => {
      if (currentVersion !== hydrationVersion) {
        return;
      }
      postRehydrationCallback == null ? void 0 : postRehydrationCallback(void 0, e);
    });
  };
  api.persist = {
    setOptions: (newOptions) => {
      options = {
        ...options,
        ...newOptions
      };
      if (newOptions.storage) {
        storage = newOptions.storage;
      }
    },
    clearStorage: () => {
      ++hydrationVersion;
      storage == null ? void 0 : storage.removeItem(options.name);
    },
    getOptions: () => options,
    rehydrate: () => hydrate(),
    hasHydrated: () => hasHydrated,
    onHydrate: (cb) => {
      hydrationListeners.add(cb);
      return () => {
        hydrationListeners.delete(cb);
      };
    },
    onFinishHydration: (cb) => {
      finishHydrationListeners.add(cb);
      return () => {
        finishHydrationListeners.delete(cb);
      };
    }
  };
  if (!options.skipHydration) {
    hydrate();
  }
  return stateFromStorage || configResult;
};
const persist = persistImpl;
const BUILTIN_NOTIFICATION_SOUND_IDS = [
  "lite",
  "food",
  "quiet",
  "glass",
  "bell",
  "pop",
  "pulse",
  "success"
];
const NOTIFICATION_SOUND_LABELS = {
  lite: "Lite",
  food: "Food",
  quiet: "Quiet",
  glass: "Glass",
  bell: "Bell",
  pop: "Pop",
  pulse: "Pulse",
  success: "Success"
};
const DEFAULT_NOTIFICATION_SOUNDS = {
  taskComplete: "lite",
  permissionApproval: "food",
  planApproval: "quiet"
};
const VALID_NOTIFICATION_SOUND_CHOICES = /* @__PURE__ */ new Set([
  ...BUILTIN_NOTIFICATION_SOUND_IDS,
  "none"
]);
function isNotificationSoundChoice(value) {
  return VALID_NOTIFICATION_SOUND_CHOICES.has(value);
}
function normalizeNotificationSounds(value) {
  const saved = value && typeof value === "object" ? value : {};
  return {
    taskComplete: isNotificationSoundChoice(saved.taskComplete) ? saved.taskComplete : DEFAULT_NOTIFICATION_SOUNDS.taskComplete,
    permissionApproval: isNotificationSoundChoice(saved.permissionApproval) ? saved.permissionApproval : DEFAULT_NOTIFICATION_SOUNDS.permissionApproval,
    planApproval: isNotificationSoundChoice(saved.planApproval) ? saved.planApproval : DEFAULT_NOTIFICATION_SOUNDS.planApproval
  };
}
function extractModelsFromEnv(env) {
  const modelKeys = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL"
  ];
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  for (const key of modelKeys) {
    const val = env[key];
    if (val && typeof val === "string" && val.trim() && !seen.has(val)) {
      seen.add(val);
      models.push(val);
    }
  }
  return models;
}
const PROVIDER_PRESETS = [
  // ── CN Official Providers ──────────────────────────────────────
  {
    id: "minimax",
    name: "MiniMax Token Plan",
    nameIntl: "MiniMax Token Plan (China)",
    accessPlan: {
      brandId: "minimax",
      brandName: "MiniMax",
      brandNameIntl: "MiniMax",
      planName: "Token Plan（国内）",
      planNameIntl: "Token Plan (China)",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://platform.minimaxi.com/user-center/payment/coding-plan?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    note: "国内版本（minimaxi.com），需使用 Token Plan 专属密钥；该密钥与按量 API Key 不互通。注意：MiniMax-M2.7 是文本模型，本身不识图，发图后模型会忽略图片只看文字；需要识图请切到 Claude / GPT-5 / Gemini 等带视觉能力的模型。",
    description: "国产领先的 AI 编程模型，性价比高，新手推荐",
    apiKeyGuide: {
      steps: [
        "打开 MiniMax 官网",
        "注册或登录 MiniMax 账号",
        "开通 Token Plan 订阅",
        "在密钥管理页面创建 Token Plan 专属密钥"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
        ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7"
      }
    },
    displayModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]
  },
  {
    id: "minimax-api",
    name: "MiniMax 按量 API",
    nameIntl: "MiniMax API (China)",
    accessPlan: {
      brandId: "minimax",
      brandName: "MiniMax",
      brandNameIntl: "MiniMax",
      planName: "按量 API（国内）",
      planNameIntl: "Pay-as-you-go API (China)",
      billingMode: "payg"
    },
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "MiniMax 开放平台按量计费 API",
    note: "使用按量计费 API Key，不消耗 Token Plan 套餐额度；虽然 Base URL 相同，两类密钥仍不可混用。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimaxi.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
        ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7"
      }
    },
    displayModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]
  },
  {
    id: "openai",
    name: "OpenAI",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "OpenAI 官方 API，支持 GPT 和 Codex 模型",
    descriptionIntl: "Official OpenAI API, supports GPT and Codex models",
    note: "OpenAI 官方平台，Codex 模型使用 Responses API 自动适配",
    noteIntl: "Use your OpenAI API key from the official platform. Codex models are routed through the Responses API automatically.",
    apiFormat: "openai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.openai.com/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "gpt-5.6-sol",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gpt-5.6-luna",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.6-terra",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.6-sol",
        ANTHROPIC_SMALL_FAST_MODEL: "gpt-5.6-luna"
      }
    },
    displayModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
    imageApiProvider: "openai",
    imageModels: ["gpt-image-2"]
  },
  {
    id: "openai-oauth",
    name: "ChatGPT 订阅",
    nameIntl: "ChatGPT Subscription",
    category: "overseas",
    authType: "oauth",
    requiresProxy: true,
    apiFormat: "openai",
    hideBaseUrl: true,
    recommendedIntl: true,
    recommendedOrderIntl: 1,
    description: "用 ChatGPT Plus/Pro 订阅调用 Codex 模型，无需 API Key，走订阅配额",
    descriptionIntl: "Use your ChatGPT Plus/Pro subscription to call Codex models — no API key, runs on your subscription quota",
    note: "登录时会跳转到 OpenAI 官方 Codex CLI 授权页；该功能依赖 OpenAI 内部契约，可能随策略调整而失效。默认主模型为 gpt-5.6-terra；如账号无权限或被版本门控，可切换到 gpt-5.4-mini 或 gpt-5.3-codex-spark。",
    noteIntl: "Sign-in opens the official OpenAI Codex CLI authorization flow. This channel depends on OpenAI internal contracts and may break if they change. The default model is gpt-5.6-terra; if your account lacks access or the model is version-gated, switch to gpt-5.4-mini or gpt-5.3-codex-spark.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://chatgpt.com/backend-api/codex/responses",
        // Sentinel — proxy swaps in the real OAuth access_token per request.
        ANTHROPIC_AUTH_TOKEN: "oauth-managed",
        ANTHROPIC_MODEL: "gpt-5.6-terra",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gpt-5.6-luna",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-5.6-terra",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-5.6-sol",
        ANTHROPIC_SMALL_FAST_MODEL: "gpt-5.6-luna"
      }
    },
    displayModels: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex-spark"]
  },
  {
    id: "grok-oauth",
    name: "Grok 订阅",
    nameIntl: "Grok Subscription",
    category: "overseas",
    authType: "oauth",
    requiresProxy: true,
    apiFormat: "openai",
    imageApiProvider: "openai",
    imageBaseUrl: "https://api.x.ai/v1",
    imageModels: ["grok-imagine-image", "grok-imagine-image-quality"],
    hideBaseUrl: true,
    description: "用 X / SuperGrok 账号登录，直连 xAI 订阅配额，无需 API Key",
    descriptionIntl: "Sign in with X / SuperGrok and use Grok through your subscription quota — no API key required",
    note: "登录时会跳转到 xAI 官方授权页（auth.x.ai），凭 SuperGrok 订阅调用 Grok 模型。该通道复用 xAI 官方 grok CLI 的 OAuth 客户端，xAI 改契约时可能失效。xAI 官方模型列表当前推荐 grok-4.6 用于代码和聊天，窗口为 500k tokens。",
    noteIntl: "Sign-in opens xAI's authorization page (auth.x.ai). It uses your SuperGrok subscription quota. This channel reuses xAI's official Grok CLI OAuth client and may break if xAI changes the contract. xAI's official model list currently recommends grok-4.6 for code and chat, with a 500k-token context window.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.x.ai/v1",
        ANTHROPIC_AUTH_TOKEN: "oauth-managed",
        ANTHROPIC_MODEL: "grok-4.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "grok-4.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "grok-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "grok-4.6",
        ANTHROPIC_SMALL_FAST_MODEL: "grok-4.6"
      }
    },
    displayModels: ["grok-4.6"],
    modelContextWindows: {
      "grok-4.6": 5e5
    }
  },
  {
    id: "antigravity-oauth",
    name: "Antigravity 订阅",
    nameIntl: "Antigravity Subscription",
    category: "overseas",
    authType: "oauth",
    requiresProxy: true,
    apiFormat: "antigravity",
    hideBaseUrl: true,
    recommendedIntl: true,
    recommendedOrderIntl: 2,
    description: "用 Google 账号登录 Antigravity (agy)，免费额度够日常用；Pro / Ultra 订阅配额更高",
    descriptionIntl: "Sign in with a Google account to Antigravity (agy) — free tier is enough for daily use, Pro / Ultra subscriptions get higher quota",
    note: "Antigravity 是 Google DeepMind 推出的新一代 AI 编程平台，已接替原 Gemini CLI 产品线。除 Gemini 系列外还原生提供 Claude Sonnet/Opus 4.6 与 GPT-OSS。免费 Google 账号也能用，Pro / Ultra 订阅配额更高。",
    noteIntl: "Antigravity is Google DeepMind's next-gen AI coding platform — it replaces the original Gemini CLI line. Beyond the Gemini family, it also serves Claude Sonnet/Opus 4.6 and GPT-OSS natively. Works with a free Google account; Pro / Ultra subscriptions get higher quota.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://daily-cloudcode-pa.googleapis.com",
        ANTHROPIC_AUTH_TOKEN: "oauth-managed",
        // 默认走最新 Flash Low，兼顾速度和订阅配额。
        ANTHROPIC_MODEL: "gemini-3.7-flash-low",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gemini-3.7-flash-low",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gemini-3.1-pro-high",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gemini-3.1-pro-high",
        ANTHROPIC_SMALL_FAST_MODEL: "gemini-3.7-flash-low"
      }
    },
    // Built-in fallback for agy 1.1.12 (2026-08-14). Signed-in accounts refresh it
    // through fetchAvailableModels. These are menu IDs; forwardAntigravity maps the 3.5
    // 三档和 3.1 Pro High 映射到服务端仍在使用的旧 API model key。
    displayModels: [
      "gemini-3.7-flash-high",
      "gemini-3.7-flash-medium",
      "gemini-3.7-flash-low",
      "gemini-3.6-flash-high",
      "gemini-3.6-flash-medium",
      "gemini-3.6-flash-low",
      "gemini-3.5-flash-high",
      "gemini-3.5-flash-medium",
      "gemini-3.5-flash-low",
      "gemini-3.1-pro-high",
      "gemini-3.1-pro-low",
      "claude-sonnet-4-6",
      "claude-opus-4-6-thinking",
      "gpt-oss-120b-medium"
    ]
  },
  {
    id: "gemini",
    name: "Gemini API",
    apiKeyUrl: "https://aistudio.google.com/apikey?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "Google AI Studio API Key，支持 Gemini 对话和 Gemini 3 Image 生图",
    descriptionIntl: "Google AI Studio API key for Gemini chat and Gemini 3 Image generation",
    note: "Google AI Studio API，使用 API Key 按量调用；生图可在「图像生成」里使用 Gemini 3 Image 模型。",
    noteIntl: "Use a Google AI Studio API key with pay-as-you-go billing. Image generation can use Gemini 3 Image models in Image Generation.",
    apiFormat: "gemini",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://generativelanguage.googleapis.com",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "gemini-3.1-pro-preview",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gemini-3.5-flash-lite",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gemini-3.6-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gemini-3.1-pro-preview",
        ANTHROPIC_SMALL_FAST_MODEL: "gemini-3.5-flash-lite"
      }
    },
    displayModels: [
      "gemini-3.1-pro-preview",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
      "gemini-3.5-flash-lite"
    ],
    imageApiProvider: "google",
    imageBaseUrl: "https://generativelanguage.googleapis.com",
    imageModels: ["gemini-3.1-flash-image", "gemini-3-pro-image"]
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    nameIntl: "OpenCode Go",
    apiKeyUrl: "https://opencode.ai/go",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "OpenCode Go 订阅，低价开放编程模型",
    descriptionIntl: "OpenCode Go subscription channel for low-cost coding models",
    note: "使用 OpenCode Go API Key，走官方 OpenAI 兼容端点。此通道支持 GLM / Kimi / DeepSeek / MiMo；MiniMax / Qwen 请添加 OpenCode Go (Anthropic) 通道。",
    noteIntl: "Use an OpenCode Go API key with the official OpenAI-compatible endpoint. This channel supports GLM, Kimi, DeepSeek and MiMo. Add OpenCode Go (Anthropic) for MiniMax and Qwen models.",
    apiKeyGuide: {
      steps: [
        "打开 OpenCode Go 官网",
        "登录 OpenCode Zen 并订阅 Go",
        "在 OpenCode Go 页面复制 API Key",
        "复制密钥并粘贴到下方输入框"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the OpenCode Go website",
        "Sign in to OpenCode Zen and subscribe to Go",
        "Copy your API key from the OpenCode Go page",
        "Paste the key into the field below"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://opencode.ai/zen/go/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.7-code",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
        ANTHROPIC_SMALL_FAST_MODEL: "deepseek-v4-flash"
      }
    },
    // OpenCode Go official docs (2026-08-14) mark these models as /v1/chat/completions.
    displayModels: [
      "glm-5.3",
      "glm-5.2",
      "glm-5.1",
      "kimi-k2.7-code",
      "kimi-k2.6",
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "mimo-v2.5-pro",
      "mimo-v2.5"
    ],
    modelContextWindows: {
      "kimi-k2.7-code": 256e3,
      "kimi-k2.6": 256e3,
      "deepseek-v4-pro": 1e6,
      "deepseek-v4-flash": 1e6
    }
  },
  {
    id: "opencode-go-anthropic",
    name: "OpenCode Go (Anthropic)",
    nameIntl: "OpenCode Go (Anthropic)",
    apiKeyUrl: "https://opencode.ai/go",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "OpenCode Go 订阅，MiniMax / Qwen 通道",
    descriptionIntl: "OpenCode Go subscription channel for MiniMax and Qwen models",
    note: "使用 OpenCode Go API Key 的 Anthropic Messages 通道，适用于官方标注为 /v1/messages 的 MiniMax / Qwen 模型。GLM / Kimi / DeepSeek / MiMo 请使用 OpenCode Go 通道。",
    noteIntl: "Use an OpenCode Go API key with the Anthropic Messages endpoint. This channel is for MiniMax and Qwen models marked as /v1/messages. Use OpenCode Go for GLM, Kimi, DeepSeek and MiMo.",
    apiKeyGuide: {
      steps: [
        "打开 OpenCode Go 官网",
        "登录 OpenCode Zen 并订阅 Go",
        "在 OpenCode Go 页面复制 API Key",
        "复制密钥并粘贴到下方输入框"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the OpenCode Go website",
        "Sign in to OpenCode Zen and subscribe to Go",
        "Copy your API key from the OpenCode Go page",
        "Paste the key into the field below"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://opencode.ai/zen/go",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: "minimax-m3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "qwen3.7-plus",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "minimax-m3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "qwen3.7-max",
        ANTHROPIC_SMALL_FAST_MODEL: "qwen3.7-plus"
      }
    },
    // OpenCode Go official docs (2026-06-20) mark these models as /v1/messages.
    displayModels: [
      "minimax-m3",
      "minimax-m2.7",
      "minimax-m2.5",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-plus"
    ]
  },
  {
    id: "anthropic",
    name: "Anthropic",
    nameIntl: "Anthropic",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "Anthropic 官方 API，原生支持 Claude 全系列模型",
    descriptionIntl: "Anthropic's official API — native access to the full Claude model family",
    note: "Anthropic 官方平台，需在 console.anthropic.com 创建 API key 并充值后使用",
    noteIntl: "Use an API key from console.anthropic.com. Billing and usage are managed directly by Anthropic.",
    apiKeyField: "ANTHROPIC_API_KEY",
    // Intentionally NOT in the curated intl recommended list:
    // 「我有 Claude 账号」 path already covers Claude OAuth via terminal login,
    // so Anthropic API key path stays as a "View all providers" advanced option
    // to avoid confusing users who just rejected the Claude OAuth choice.
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.anthropic.com",
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_MODEL: "claude-fable-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
        ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001"
      }
    },
    displayModels: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]
  },
  {
    id: "minimax-en",
    name: "MiniMax Token Plan（国际）",
    nameIntl: "MiniMax Token Plan (Global)",
    accessPlan: {
      brandId: "minimax",
      brandName: "MiniMax",
      brandNameIntl: "MiniMax",
      planName: "Token Plan（国际）",
      planNameIntl: "Token Plan (Global)",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://platform.minimax.io/subscribe/coding-plan?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "MiniMax 国际版，适合海外用户",
    descriptionIntl: "MiniMax's hosted API, available worldwide",
    note: "国际版本（minimax.io），适合海外用户，需先开通 Coding Plan。注意：MiniMax-M2.7 是文本模型，本身不识图，发图后模型会忽略图片只看文字；需要识图请切到 Claude / GPT-5 / Gemini 等带视觉能力的模型。",
    noteIntl: "Use the global minimax.io endpoint. A Coding Plan subscription is required. MiniMax-M2.7 is text-only; image attachments are ignored by the model. Use Claude, GPT-5, Gemini, or another vision-capable model for image tasks.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.minimax.io/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
        ANTHROPIC_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.7",
        ANTHROPIC_SMALL_FAST_MODEL: "MiniMax-M2.7"
      }
    },
    displayModels: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"]
  },
  {
    id: "kimi",
    name: "Kimi Coding Plan",
    nameIntl: "Kimi Coding Plan",
    accessPlan: {
      brandId: "kimi",
      brandName: "Kimi",
      brandNameIntl: "Kimi",
      planName: "Coding Plan",
      planNameIntl: "Coding Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://www.kimi.com/code?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "Kimi 智能助手的编程版，月之暗面出品",
    descriptionIntl: "Kimi's coding edition, by Moonshot AI",
    apiKeyGuide: {
      steps: [
        "打开 Kimi 官网",
        "注册或登录 Kimi 账号",
        "开通 Kimi Coding Plan",
        "获取你的 API 密钥"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the Kimi website using the button below",
        "Sign up or sign in to your Kimi account",
        "Activate the Kimi Coding Plan",
        "Generate your API key"
      ]
    },
    note: "需先开通 Kimi Coding Plan。所有套餐可用 kimi-for-coding；Moderato 及以上可用 K3，Allegretto 及以上可用 K3 1M 和 kimi-for-coding-highspeed。如果您使用 Kimi API 按量计费，请选择 Moonshot。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.kimi.com/coding/",
        ANTHROPIC_AUTH_TOKEN: ""
      }
    },
    displayModels: ["kimi-for-coding", "k3", "k3[1m]", "kimi-for-coding-highspeed"],
    modelContextWindows: {
      "kimi-for-coding": 256e3,
      k3: 256e3,
      "k3[1m]": 1e6,
      "kimi-for-coding-highspeed": 256e3
    }
  },
  {
    id: "moonshot",
    name: "Moonshot",
    accessPlan: {
      brandId: "moonshot",
      brandName: "Moonshot",
      brandNameIntl: "Moonshot",
      planName: "按量 API",
      planNameIntl: "Pay-as-you-go API",
      billingMode: "payg"
    },
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "月之暗面开放平台，按量计费",
    note: "月之暗面开放平台，按量计费",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.moonshot.cn/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
        ANTHROPIC_SMALL_FAST_MODEL: "kimi-k2.6"
      }
    },
    displayModels: ["kimi-k3", "kimi-k2.6"],
    modelContextWindows: {
      "kimi-k3": 1e6,
      "kimi-k2.6": 256e3
    }
  },
  {
    id: "zhipu",
    name: "智谱 GLM Coding Plan",
    nameIntl: "Zhipu GLM Coding Plan",
    accessPlan: {
      brandId: "zhipu",
      brandName: "智谱",
      brandNameIntl: "Zhipu",
      planName: "GLM Coding Plan",
      planNameIntl: "GLM Coding Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://bigmodel.cn/usercenter/glm-coding/my-plan?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "智谱 GLM 大模型，国内老牌 AI 厂商",
    apiKeyGuide: {
      steps: [
        "打开智谱开放平台",
        "注册或登录智谱账号",
        "开通 GLM Coding Plan",
        "在 API 密钥页面创建新密钥"
      ]
    },
    note: "需先开通 GLM Coding Plan",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000",
        ANTHROPIC_MODEL: "glm-5.3[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
        ANTHROPIC_SMALL_FAST_MODEL: "glm-4.7"
      }
    },
    displayModels: ["glm-5.3[1m]", "glm-5-turbo", "glm-4.7"]
  },
  {
    id: "zhipu-api",
    name: "智谱开放平台 API",
    nameIntl: "Zhipu API",
    accessPlan: {
      brandId: "zhipu",
      brandName: "智谱",
      brandNameIntl: "Zhipu",
      planName: "按量 API",
      planNameIntl: "Pay-as-you-go API",
      billingMode: "payg"
    },
    apiKeyUrl: "https://bigmodel.cn/usercenter/proj-mgmt/apikeys",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "智谱开放平台按量计费 API",
    note: "使用智谱开放平台通用 API Key，按实际 Token 用量计费；不能使用 GLM Coding Plan 专属密钥。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5-turbo",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2",
        ANTHROPIC_SMALL_FAST_MODEL: "glm-5-turbo"
      }
    },
    displayModels: ["glm-5.2", "glm-5-turbo", "glm-4.7"]
  },
  {
    id: "zai",
    name: "Z.ai",
    apiKeyUrl: "https://z.ai/model-api?utm_source=niumaai",
    category: "overseas",
    hideBaseUrl: true,
    description: "智谱国际版，适合海外用户",
    descriptionIntl: "Zhipu's GLM models, hosted globally",
    note: "智谱国际版（z.ai），适合海外用户",
    noteIntl: "Use Z.ai, the global GLM API endpoint from Zhipu.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "1000000",
        ANTHROPIC_MODEL: "glm-5.3[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3[1m]",
        ANTHROPIC_SMALL_FAST_MODEL: "glm-4.7"
      }
    },
    displayModels: ["glm-5.3[1m]", "glm-5-turbo", "glm-4.7"]
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "DeepSeek 深度求索，按量计费",
    note: "按量计费，需先充值",
    apiKeyGuide: {
      steps: [
        "打开 DeepSeek 开放平台",
        "注册或登录 DeepSeek 账号",
        "充值账户余额（按量计费）",
        "在 API Keys 页面创建新的 API 密钥"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro",
        ANTHROPIC_SMALL_FAST_MODEL: "deepseek-v4-flash"
      }
    },
    displayModels: [
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-v4-flash-vision-exp"
    ],
    modelContextWindows: {
      "deepseek-v4-pro": 1e6,
      "deepseek-v4-flash": 1e6,
      "deepseek-v4-flash-vision-exp": 1e6
    }
  },
  {
    id: "bailian",
    name: "百炼 Coding Plan",
    nameIntl: "Bailian Coding Plan",
    accessPlan: {
      brandId: "bailian",
      brandName: "阿里云百炼",
      brandNameIntl: "Alibaba Cloud Model Studio",
      planName: "Coding Plan",
      planNameIntl: "Coding Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://bailian.console.aliyun.com/cn-beijing?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "阿里云百炼，通义千问系列模型",
    note: "阿里云百炼，需先开通 Coding Plan",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: ""
      }
    },
    displayModels: [
      "qwen3.7-plus",
      "qwen3.6-plus",
      "kimi-k2.5",
      "glm-5",
      "MiniMax-M2.5",
      "qwen3.5-plus",
      "qwen3-max-2026-01-23",
      "qwen3-coder-next",
      "qwen3-coder-plus",
      "glm-4.7"
    ],
    imageApiProvider: "dashscope",
    imageBaseUrl: "https://dashscope.aliyuncs.com",
    imageModels: ["z-image-turbo"]
  },
  {
    id: "bailian-token-plan",
    name: "百炼 Token Plan",
    nameIntl: "Model Studio Token Plan",
    accessPlan: {
      brandId: "bailian",
      brandName: "阿里云百炼",
      brandNameIntl: "Alibaba Cloud Model Studio",
      planName: "Token Plan",
      planNameIntl: "Token Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://bailian.console.aliyun.com/cn-beijing/?tab=model#/efm/model_experience_center/subscription",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "阿里云百炼 Token Plan 订阅套餐",
    note: "使用 Token Plan 专属 sk-sp- 密钥；Token Plan、Coding Plan 和按量 API 的密钥与 Base URL 完全隔离。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
        ANTHROPIC_AUTH_TOKEN: ""
      }
    },
    displayModels: [
      "qwen3.8-max-preview",
      "qwen3.7-max",
      "qwen3.7-plus",
      "qwen3.6-flash",
      "glm-5.2",
      "deepseek-v4-pro"
    ]
  },
  {
    id: "bailian-api",
    name: "百炼按量 API",
    nameIntl: "Model Studio API",
    accessPlan: {
      brandId: "bailian",
      brandName: "阿里云百炼",
      brandNameIntl: "Alibaba Cloud Model Studio",
      planName: "按量 API",
      planNameIntl: "Pay-as-you-go API",
      billingMode: "payg"
    },
    apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "阿里云百炼 Model Studio 按量计费 API",
    note: "使用百炼通用 sk- API Key，按实际调用量计费；不能使用 Coding Plan 或 Token Plan 的 sk-sp- 密钥。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "qwen3.7-plus",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "qwen3.7-plus",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "qwen3.7-plus",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "qwen3.7-max",
        ANTHROPIC_SMALL_FAST_MODEL: "qwen3.7-plus"
      }
    },
    displayModels: ["qwen3.7-max", "qwen3.7-plus"],
    imageApiProvider: "dashscope",
    imageBaseUrl: "https://dashscope.aliyuncs.com",
    imageModels: ["z-image-turbo"]
  },
  {
    id: "volcengine",
    name: "火山方舟 Coding Plan",
    nameIntl: "Volcengine Ark Coding Plan",
    accessPlan: {
      brandId: "volcengine",
      brandName: "火山方舟",
      brandNameIntl: "Volcengine Ark",
      planName: "Coding Plan",
      planNameIntl: "Coding Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://volcengine.com/L/VHX6WFQBzP4/",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "火山方舟 Coding Plan 编程订阅套餐",
    note: "使用 Coding Plan 专属密钥和套餐额度；切换 API 格式只会在 /api/coding 与 /api/coding/v3 两个套餐端点之间切换。",
    apiKeyGuide: {
      steps: [
        "打开火山方舟官网",
        "注册或登录字节跳动/火山引擎账号",
        "开通火山方舟 Coding Plan",
        "在 Coding Plan 页面创建套餐专属密钥"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/coding",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        ANTHROPIC_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "ark-code-latest",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "ark-code-latest",
        ANTHROPIC_SMALL_FAST_MODEL: "ark-code-latest"
      }
    },
    displayModels: ["ark-code-latest", "doubao-seed-2.0-code"]
  },
  {
    id: "volcengine-agent-plan",
    name: "火山方舟 Agent Plan",
    nameIntl: "Volcengine Ark Agent Plan",
    accessPlan: {
      brandId: "volcengine",
      brandName: "火山方舟",
      brandNameIntl: "Volcengine Ark",
      planName: "Agent Plan",
      planNameIntl: "Agent Plan",
      billingMode: "subscription"
    },
    apiKeyUrl: "https://console.volcengine.com/ark/agent-plan",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "火山方舟面向智能体场景的 Agent Plan 套餐",
    note: "使用 Agent Plan 个人版专属密钥和 /api/plan/v3 网关；不能使用 Coding Plan 或普通方舟 API Key。",
    apiKeyGuide: {
      steps: [
        "打开火山方舟 Agent Plan 控制台",
        "开通 Agent Plan 套餐",
        "进入使用配置并创建 Agent Plan 专属密钥"
      ]
    },
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/plan/v3",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        ANTHROPIC_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "doubao-seed-2.1-turbo",
        ANTHROPIC_SMALL_FAST_MODEL: "doubao-seed-2.1-turbo"
      }
    },
    displayModels: [
      "doubao-seed-evolving",
      "doubao-seed-2.1-pro",
      "doubao-seed-2.1-turbo",
      "glm-5.2",
      "kimi-k2.7-code",
      "minimax-m3",
      "deepseek-v4-pro",
      "deepseek-v4-flash"
    ],
    supportsModelList: false
  },
  {
    id: "volcengine-api",
    name: "火山方舟按量 API",
    nameIntl: "Volcengine Ark API",
    accessPlan: {
      brandId: "volcengine",
      brandName: "火山方舟",
      brandNameIntl: "Volcengine Ark",
      planName: "按量 API",
      planNameIntl: "Pay-as-you-go API",
      billingMode: "payg"
    },
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apikey",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "火山方舟通用推理 API，按实际调用量计费",
    note: "使用火山方舟通用 API Key 和 /api/v3 网关，费用不从 Coding Plan 或 Agent Plan 套餐中抵扣。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://ark.cn-beijing.volces.com/api/v3",
        ANTHROPIC_AUTH_TOKEN: "",
        API_TIMEOUT_MS: "900000",
        ANTHROPIC_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "doubao-seed-2.1-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "doubao-seed-2.1-turbo",
        ANTHROPIC_SMALL_FAST_MODEL: "doubao-seed-2.1-turbo"
      }
    },
    displayModels: ["doubao-seed-evolving", "doubao-seed-2.1-pro", "doubao-seed-2.1-turbo"]
  },
  {
    id: "stepfun",
    name: "阶跃星辰",
    apiKeyUrl: "https://platform.stepfun.com/interface-key?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "阶跃星辰，Step 3.7 / 3.5 系列模型",
    note: "按量计费，当前默认使用 step-3.7-flash，需先获取 API Key",
    apiFormat: "openai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.stepfun.com/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "step-3.7-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "step-3.5-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "step-3.7-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "step-3.7-flash",
        ANTHROPIC_SMALL_FAST_MODEL: "step-3.5-flash"
      }
    },
    displayModels: ["step-3.7-flash", "step-3.5-flash-2603", "step-3.5-flash"]
  },
  {
    id: "bailing",
    name: "百灵 (BaiLing)",
    apiKeyUrl: "https://chat.ant-ling.com/",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "蚂蚁百灵，Ling / Ring 系列模型",
    note: "蚂蚁百灵官方 API，支持 Ling 3.0 与 Ling / Ring 2.6 系列模型",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.ant-ling.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "Ling-2.6-1T",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Ling-3.0-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Ling-2.6-1T",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Ling-2.6-1T",
        ANTHROPIC_SMALL_FAST_MODEL: "Ling-3.0-flash"
      }
    },
    displayModels: ["Ling-3.0-flash", "Ling-2.6-1T", "Ring-2.6-1T", "Ling-2.6-flash"],
    modelContextWindows: {
      "Ling-3.0-flash": 256e3,
      "Ling-2.6-1T": 256e3,
      "Ring-2.6-1T": 256e3,
      "Ling-2.6-flash": 256e3
    }
  },
  {
    id: "longcat",
    name: "Longcat",
    apiKeyUrl: "https://longcat.chat/platform/api_keys?utm_source=niumaai",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "美团 LongCat 2.0，百万上下文 Agent 模型",
    note: "LongCat 旧 Flash 系列已下线，当前官方 API 使用 LongCat-2.0。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.longcat.chat/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "LongCat-2.0",
        ANTHROPIC_SMALL_FAST_MODEL: "LongCat-2.0",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "131072",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1
      }
    },
    displayModels: ["LongCat-2.0"]
  },
  {
    id: "xiaomimimo",
    name: "小米 MiMo",
    apiKeyUrl: "https://platform.xiaomimimo.com/?utm_source=niumaai#/console/api-keys",
    category: "cn_official",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "小米 MiMo 开放平台",
    note: "小米 MiMo V2 系列已下线，请使用 MiMo V2.5 Pro 或 V2.5。",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.xiaomimimo.com/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_SMALL_FAST_MODEL: "mimo-v2.5"
      }
    },
    displayModels: ["mimo-v2.5-pro", "mimo-v2.5"]
  },
  // ── Aggregators ────────────────────────────────────────────────
  {
    id: "openrouter",
    name: "OpenRouter",
    apiKeyUrl: "https://openrouter.ai/keys?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    recommendedIntl: true,
    recommendedOrderIntl: 3,
    description: "多模型聚合平台，支持 Claude/GPT 等",
    descriptionIntl: "Multi-model aggregation platform, supports Claude/GPT etc.",
    note: "多模型聚合平台，支持多家模型按量计费",
    noteIntl: "Multi-model router with pay-as-you-go access to many hosted providers. Model availability and pricing follow your OpenRouter account.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "anthropic/claude-fable-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-5",
        ANTHROPIC_SMALL_FAST_MODEL: "anthropic/claude-haiku-4.5"
      }
    },
    displayModels: ["anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-sonnet-5", "anthropic/claude-haiku-4.5"]
  },
  {
    id: "siliconflow",
    name: "SiliconFlow",
    apiKeyUrl: "https://cloud.siliconflow.com/me/account/ak?utm_source=niumaai",
    category: "overseas",
    hideBaseUrl: true,
    description: "硅基流动国际版，海外模型聚合",
    descriptionIntl: "SiliconFlow's hosted model aggregation platform",
    note: "硅基流动国际版（siliconflow.com）",
    noteIntl: "Use the global siliconflow.com endpoint for hosted model aggregation.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.siliconflow.com/",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_SMALL_FAST_MODEL: "MiniMaxAI/MiniMax-M2.7"
      }
    },
    displayModels: ["MiniMaxAI/MiniMax-M2.7", "zai-org/GLM-5.1", "MiniMaxAI/MiniMax-M2.5", "zai-org/GLM-4.7"]
  },
  {
    id: "siliconflow-cn",
    name: "硅基流动",
    nameIntl: "SiliconFlow China",
    apiKeyUrl: "https://cloud.siliconflow.cn/me/account/ak?utm_source=niumaai",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "硅基流动国内版，国产模型聚合",
    note: "硅基流动国内版（siliconflow.cn）",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.siliconflow.cn",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7",
        ANTHROPIC_SMALL_FAST_MODEL: "Pro/MiniMaxAI/MiniMax-M2.7"
      }
    },
    displayModels: ["Pro/MiniMaxAI/MiniMax-M2.7", "Pro/zai-org/GLM-5.1", "Pro/MiniMaxAI/MiniMax-M2.5"]
  },
  {
    id: "zenmux",
    name: "ZenMux",
    apiKeyUrl: "https://zenmux.ai/invite/H3QVHO?utm_source=niumaai",
    category: "overseas",
    hideBaseUrl: true,
    description: "自动路由聚合，支持故障转移",
    descriptionIntl: "Auto-routing aggregation with failover support",
    note: "自动路由聚合平台，支持故障转移",
    noteIntl: "Auto-routing model gateway with failover. The default auto route lets ZenMux choose an available upstream model.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://zenmux.ai/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "zenmux/auto",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.7",
        ANTHROPIC_SMALL_FAST_MODEL: "anthropic/claude-sonnet-4.6"
      }
    },
    displayModels: ["zenmux/auto", "anthropic/claude-opus-4.7", "anthropic/claude-sonnet-4.6"]
  },
  {
    id: "modelscope",
    name: "ModelScope",
    apiKeyUrl: "https://modelscope.cn?utm_source=niumaai",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "魔搭社区，阿里云模型推理服务",
    note: "魔搭社区，阿里云模型推理服务",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api-inference.modelscope.cn",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "ZhipuAI/GLM-5.1",
        ANTHROPIC_SMALL_FAST_MODEL: "ZhipuAI/GLM-5.1"
      }
    },
    displayModels: ["ZhipuAI/GLM-5.1", "ZhipuAI/GLM-5", "ZhipuAI/GLM-4.7"]
  },
  {
    id: "aihubmix",
    name: "AiHubMix",
    apiKeyUrl: "https://aihubmix.com?utm_source=niumaai",
    category: "overseas",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "模型聚合服务，支持 Claude 等",
    descriptionIntl: "Model aggregation service, supports Claude etc.",
    note: "国内模型聚合服务",
    noteIntl: "Model aggregation service with Claude-compatible endpoints. Availability depends on your AiHubMix account and selected channel.",
    apiKeyField: "ANTHROPIC_API_KEY",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://aihubmix.com",
        ANTHROPIC_API_KEY: ""
      }
    },
    displayModels: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"]
  },
  {
    id: "nvidia",
    name: "Nvidia",
    apiKeyUrl: "https://build.nvidia.com/settings/api-keys?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "Nvidia Build API，GPU 推理平台",
    descriptionIntl: "Nvidia Build API, GPU inference platform",
    note: "Nvidia Build API",
    apiFormat: "openai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://integrate.api.nvidia.com",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "moonshotai/kimi-k2.6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "moonshotai/kimi-k2.6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "moonshotai/kimi-k2.6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "moonshotai/kimi-k2.6",
        ANTHROPIC_SMALL_FAST_MODEL: "moonshotai/kimi-k2.6"
      }
    },
    displayModels: ["moonshotai/kimi-k2.6", "moonshotai/kimi-k2.5"]
  },
  {
    id: "gptnb",
    name: "GPTNB",
    apiKeyUrl: "https://oneapi.gptnb.ai",
    category: "aggregator",
    domesticOnly: true,
    apiFormat: "openai",
    hideBaseUrl: false,
    description: "可用 Claude 的模型聚合服务，也可接入 gpt-image-2 / gpt-image-2-vip 生图模型",
    descriptionIntl: "Model aggregation service with Claude support, plus gpt-image-2 and gpt-image-2-vip for image generation",
    apiKeyGuide: {
      steps: [
        "打开 GPTNB 官网",
        "注册或登录 GPTNB 账号",
        "在控制台获取你的 API 密钥",
        "将站点地址填入下方 API Base URL",
        "复制密钥并粘贴到下方输入框"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the GPTNB website",
        "Sign up or sign in to your GPTNB account",
        "Get your API key from the dashboard",
        "Enter the site URL in the API Base URL field below",
        "Paste the API key into the field below"
      ]
    },
    note: "可用 Claude，最全模型聚合服务；对话 API Base URL 需自行填写。生图默认走 GPTNB OpenAI 兼容接口 one-cn2.gptnb.ai/v1，默认模型为 gpt-image-2-vip（支持分层多图返回）和 gpt-image-2。",
    noteIntl: "Claude-capable model aggregator. Enter your chat API Base URL manually. Image generation uses GPTNB OpenAI-compatible endpoint one-cn2.gptnb.ai/v1 by default, with gpt-image-2-vip for layered image output and gpt-image-2 as alternatives.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_SMALL_FAST_MODEL: "claude-sonnet-4-6"
      }
    },
    displayModels: ["claude-sonnet-4-6"],
    imageApiProvider: "openai",
    imageBaseUrl: "https://one-cn2.gptnb.ai/v1",
    imageModels: ["gpt-image-2-vip", "gpt-image-2"]
  },
  // ── Third Party ────────────────────────────────────────────────
  {
    id: "pipellm-claude",
    name: "Pipellm (Claude)",
    apiKeyUrl: "https://code.pipellm.ai/login?ref=h9ymzm06",
    category: "overseas",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "推特大佬 Cydia 官方 Claude 渠道",
    descriptionIntl: "Cydia's official Claude channel (community-recommended)",
    apiKeyGuide: {
      steps: [
        "打开 Pipellm 官网",
        "注册或登录 Pipellm 账号",
        "在控制台创建 Claude 渠道的 API 密钥",
        "复制密钥并粘贴到下方输入框"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the Pipellm website using the button below",
        "Sign up or sign in to your Pipellm account",
        "In the console, create an API key for the Claude channel",
        "Paste the key into the input below"
      ]
    },
    note: "推特大佬 Cydia 官方 Claude 渠道",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://cc-api.pipellm.ai",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-opus-4-7",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-4-7",
        ANTHROPIC_REASONING_MODEL: "claude-opus-4-7"
      }
    },
    displayModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]
  },
  {
    id: "pipellm-aggregator",
    name: "Pipellm (聚合)",
    nameIntl: "Pipellm Aggregator",
    apiKeyUrl: "https://code.pipellm.ai/login?ref=h9ymzm06",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: true,
    apiFormat: "openai",
    description: "推特大佬 Cydia 模型聚合服务",
    descriptionIntl: "Cydia's model aggregator service (community-recommended)",
    apiKeyGuide: {
      steps: [
        "打开 Pipellm 官网",
        "注册或登录 Pipellm 账号",
        "在控制台创建聚合渠道的 API 密钥",
        "复制密钥并粘贴到下方输入框"
      ]
    },
    apiKeyGuideIntl: {
      steps: [
        "Open the Pipellm website using the button below",
        "Sign up or sign in to your Pipellm account",
        "In the console, create an API key for the aggregator channel",
        "Paste the key into the input below"
      ]
    },
    note: "推特大佬 Cydia 模型聚合服务",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://cc-api.pipellm.ai/v1/",
        ANTHROPIC_AUTH_TOKEN: ""
      }
    }
  },
  {
    id: "dmxapi",
    name: "DMXAPI",
    apiKeyUrl: "https://www.dmxapi.cn?utm_source=niumaai",
    category: "overseas",
    domesticOnly: true,
    hideBaseUrl: true,
    description: "国内镜像代理，支持 Claude 等海外模型",
    descriptionIntl: "API proxy, supports Claude and other hosted models",
    note: "国内镜像代理服务",
    noteIntl: "API proxy for Claude and other hosted models. Configure this only if your DMXAPI account has the corresponding model channels enabled.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://www.dmxapi.cn",
        ANTHROPIC_AUTH_TOKEN: ""
      }
    },
    displayModels: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"]
  },
  // ── Local / Self-hosted ────────────────────────────────────────
  {
    id: "ollama",
    name: "Ollama",
    apiKeyUrl: "https://docs.ollama.com/integrations/claude-code?utm_source=niumaai",
    category: "local",
    description: "本地运行开源模型，无需 API 密钥",
    descriptionIntl: "Run open-source models locally, no API key needed",
    note: "本地模型服务，默认端口 11434",
    noteIntl: "Runs models locally through Ollama. Make sure Ollama is running and the selected model is pulled. Default endpoint: localhost:11434.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "http://localhost:11434",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-4.7-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-4.7-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-4.7-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-4.7-flash",
        ANTHROPIC_SMALL_FAST_MODEL: "glm-4.7-flash"
      }
    }
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    apiKeyUrl: "https://lmstudio.ai/?utm_source=niumaai",
    category: "local",
    description: "本地模型管理工具，可视化操作",
    descriptionIntl: "Local model management tool, visual interface",
    note: "本地模型服务，默认端口 1234",
    noteIntl: "Runs models locally through LM Studio. Start the local server in LM Studio before using this provider. Default endpoint: localhost:1234.",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "http://localhost:1234",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "openai/gpt-oss-20b",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "openai/gpt-oss-20b",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "openai/gpt-oss-20b",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "openai/gpt-oss-20b",
        ANTHROPIC_SMALL_FAST_MODEL: "openai/gpt-oss-20b"
      }
    }
  },
  {
    id: "groq",
    name: "Groq",
    apiKeyUrl: "https://console.groq.com/keys?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "高速推理平台，专注开源模型",
    descriptionIntl: "High-speed inference platform, open-source models",
    note: "高速推理平台，专注开源模型",
    noteIntl: "High-speed hosted inference for open-source models through Groq. Use models supported by your Groq account.",
    apiFormat: "openai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.groq.com/openai/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "openai/gpt-oss-120b",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "openai/gpt-oss-20b",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "openai/gpt-oss-120b",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "openai/gpt-oss-120b",
        ANTHROPIC_SMALL_FAST_MODEL: "openai/gpt-oss-20b"
      }
    },
    displayModels: ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.6-27b"]
  },
  // ── Channel / Reseller ─────────────────────────────────────
  {
    id: "anthropic-channel",
    name: "Anthropic 渠道商",
    nameIntl: "Anthropic Reseller",
    category: "aggregator",
    domesticOnly: true,
    hideBaseUrl: false,
    description: "通过第三方渠道商访问 Claude（自定义 API 地址）",
    descriptionIntl: "Access Claude through a third-party reseller (custom API URL)",
    note: "适用于通过渠道商/代理商提供的 Anthropic 兼容 API 访问 Claude，模型名称与官方一致",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
        ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001"
      }
    },
    displayModels: ["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]
  },
  {
    id: "cerebras",
    name: "Cerebras",
    apiKeyUrl: "https://cloud.cerebras.ai/?utm_source=niumaai",
    category: "overseas",
    requiresProxy: true,
    hideBaseUrl: true,
    description: "高速推理芯片平台",
    descriptionIntl: "High-speed inference chip platform",
    note: "高速推理芯片平台",
    noteIntl: "Hosted inference on Cerebras hardware for supported open-source models.",
    apiFormat: "openai",
    settingsConfig: {
      env: {
        ANTHROPIC_BASE_URL: "https://api.cerebras.ai/v1",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "gpt-oss-120b",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "gpt-oss-120b",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "gpt-oss-120b",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "gpt-oss-120b",
        ANTHROPIC_SMALL_FAST_MODEL: "gpt-oss-120b"
      }
    },
    displayModels: ["gpt-oss-120b", "zai-glm-4.7"]
  }
];
const EDITION_PROVIDER_PRESETS = edition.features.domesticProviders ? PROVIDER_PRESETS : PROVIDER_PRESETS.filter((p) => !p.domesticOnly).map((p) => p.category === "aggregator" ? { ...p, category: "overseas" } : p);
function normalizeProviderApiKeys(provider) {
  const keys = [
    ...Array.isArray(provider?.apiKeys) ? provider.apiKeys : [],
    provider?.apiKey
  ].map((key) => typeof key === "string" ? key.trim() : "").filter(Boolean);
  return Array.from(new Set(keys));
}
function providerHasApiKey(provider) {
  return normalizeProviderApiKeys(provider).length > 0;
}
function normalizeProviderCredentialFields(provider) {
  const apiKeys = normalizeProviderApiKeys(provider);
  return {
    ...provider,
    apiKey: apiKeys[0] ?? "",
    apiKeys,
    apiKeyRotationEnabled: apiKeys.length > 1 ? provider.apiKeyRotationEnabled === true : false
  };
}
const MAX_MODELS = 20;
function applyProviderCapabilityManualOverrides(capabilities) {
  const overrides = capabilities?.manualOverrides;
  if (!capabilities || !overrides) return capabilities;
  const { contextWindow: _contextWindow, ...capabilityOverrides } = overrides;
  const hasManualReasoning = Object.prototype.hasOwnProperty.call(overrides, "reasoning");
  const reasoning = hasManualReasoning ? overrides.reasoning : overrides.thinking === false ? void 0 : capabilities.reasoning;
  return {
    ...capabilities,
    ...capabilityOverrides,
    reasoning,
    manualOverrides: overrides
  };
}
function getEffectiveModelContextWindows(provider) {
  if (!provider) return void 0;
  const effective = { ...provider.modelContextWindows ?? {} };
  for (const [modelId, capabilities] of Object.entries(provider.modelCapabilities ?? {})) {
    const override = capabilities.manualOverrides?.contextWindow;
    if (typeof override === "number" && Number.isFinite(override) && override > 0) {
      effective[modelId] = override;
    }
  }
  return Object.keys(effective).length > 0 ? effective : void 0;
}
function getModelCapabilities(provider, modelId) {
  if (!provider) return void 0;
  const perModel = provider.modelCapabilities?.[modelId];
  if (perModel) return applyProviderCapabilityManualOverrides(perModel);
  return applyProviderCapabilityManualOverrides(provider.capabilities);
}
function getReliableImageCapability(capabilities) {
  if (capabilities?.manualOverrides?.image !== void 0) {
    return capabilities.manualOverrides.image;
  }
  if (capabilities?.image !== false) return capabilities?.image;
  const reason = capabilities.reasons?.image?.trim() ?? "";
  if (/^(?:探测请求被拒绝|Probe request was rejected) \(HTTP \d{3}\)$/i.test(reason) || /API 密钥无效|鉴权失败|未授权|限流|请求超时|连接超时|网络异常|网络错误|服务器错误|服务异常|API key.{0,24}invalid|authentication failed|unauthori[sz]ed|rate limit|timed? out|timeout|network error|server error/i.test(reason)) {
    return void 0;
  }
  return false;
}
const KNOWN_VISION_MODELS = {
  // DeepSeek 官方 API 的 V4 Flash Vision 实验模型原生支持 Anthropic / OpenAI 图片块。
  deepseek: /* @__PURE__ */ new Set(["deepseek-v4-flash-vision-exp"]),
  // xAI OAuth 走非标准端点，probe 打不通；当前订阅目录保留 4.6 与 4.5。
  "grok-oauth": /* @__PURE__ */ new Set(["grok-4.6", "grok-4.5"]),
  // Antigravity 订阅（Google 自家协议，标准 probe 打不通）：逐个登记真正识图的模型。
  // 以前用 VISION_NATIVE_PROVIDERS 整片白名单，导致 GPT-OSS / extra-low effort 的 Gemini
  // 等也被默认标"已确认"。现在改成只登记实测有效的，未登记的自动 fallback 到 unknown。
  // 未列出的：
  //   - gpt-oss-120b-medium：纯文本（见下方 NON_VISION 表）
  //   - gemini-3.5-flash-extra-low：实测 effort 太低识不出图（见下方 NON_VISION 表）
  "antigravity-oauth": /* @__PURE__ */ new Set([
    "gemini-3.5-flash-low",
    "gemini-3-flash-agent",
    "gemini-3.1-pro-low",
    "gemini-pro-agent",
    "claude-sonnet-4-6",
    "claude-opus-4-6-thinking"
  ]),
  // openai-oauth = OpenAI 官方 OAuth 端点（非第三方中转），静态表是正确做法，原因：
  //   1. probe 机制物理上无法运行：openai-oauth 走 Responses API，
  //      applyCodexOAuthRequirements 强制 stream:true，而 probeCapabilities 用
  //      stream:false，非流式请求会被直接拒绝；且 probeCapabilities 对 useResponsesApi
  //      路径已完全跳过（返回空 {}）。
  //   2. 中转层差异顾虑不适用：这是 OpenAI 自家端点，无转发层。
  //   gpt-5.3-codex-spark 编码专用，已在 NON_VISION 表；其余 GPT-5.x 均为多模态。
  "openai-oauth": /* @__PURE__ */ new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2"])
};
const KNOWN_NON_VISION_MODELS = {
  // codex 后缀 = OpenAI code 专用变体，确认只支持文本。
  "openai-oauth": /* @__PURE__ */ new Set(["gpt-5.3-codex", "gpt-5.3-codex-spark"]),
  // Antigravity 订阅是 mixed-modality provider：登记不识图的模型，挡掉 VISION_NATIVE_PROVIDERS
  // 残留白名单（即便整片白名单已拆，这层显式黑名单仍是双保险）。
  //   - gpt-oss-120b-medium：纯文本模型。实测 bug：conv-1779872153628，2026-05-27
  //   - gemini-3.5-flash-extra-low：用户实测 effort 太低，识不出图
  "antigravity-oauth": /* @__PURE__ */ new Set(["gpt-oss-120b-medium", "gemini-3.5-flash-extra-low"]),
  // GLM Coding / OpenCode Go 的编程模型会对 image 块返回
  // "Model only support text input"。这些不是 GLM-4V 一类视觉模型，必须让
  // vision fallback 在发送前接管，避免原图直达上游后 400。
  //
  // DeepSeek V4 Pro / Flash 同样是纯文本模型；视觉输入只由独立的
  // deepseek-v4-flash-vision-exp 提供。失败形态两种都有：
  // Console Go 路由把错误包在 HTTP 200 SSE 里（unknown variant `image_url`, expected `text`），
  // 官方直连则**照单收下 image 块回一句"我看不了图"**，判定停留在 unknown、fallback
  // 不触发——用户实测反馈（feedback cmsg8ujrk，2026-08-05，opencode-go / deepseek-v4-flash）：
  // 模型直接放弃读图，副模型转写从未被调用。
  "opencode-go": /* @__PURE__ */ new Set(["glm-5.3", "glm-5.2", "glm-5.1", "deepseek-v4-pro", "deepseek-v4-flash"]),
  // DeepSeek 官方直连通道中的 Pro / Flash 同上；Vision Exp 在 VISION 表单独登记。
  deepseek: /* @__PURE__ */ new Set(["deepseek-v4-pro", "deepseek-v4-flash"]),
  zhipu: /* @__PURE__ */ new Set(["glm-5.3[1m]", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7"]),
  zai: /* @__PURE__ */ new Set(["glm-5.3[1m]", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7"])
};
function getKnownModelVisionSupport(modelId) {
  const normalized = modelId.trim().toLowerCase();
  const model = normalized.split("/").filter(Boolean).at(-1) ?? normalized;
  if (/^gpt-5(?:$|[._-]).*codex(?:$|[._-])/.test(model) || /^gpt-oss(?:$|[._-])/.test(model) || /^gemini-.*extra-low(?:$|[._-])/.test(model)) {
    return false;
  }
  if (/^deepseek-v4-flash-vision-exp(?:$|[._-])/.test(model) || /^grok-4\.(?:5|6)(?:$|[._-])/.test(model) || /^gpt-5(?:$|[._-])/.test(model) || /^claude-(?:opus|sonnet|haiku)(?:$|[._-])/.test(model) || /^gemini-(?:\d|pro-agent)/.test(model) || /^glm-(?:4\.6v|5v-turbo)(?:$|-)/.test(model) || /^qwen3\.[567]-(?:plus|flash)(?:$|-)/.test(model) || /^qwen3-vl(?:$|-)/.test(model) || /^kimi-(?:k3|k2\.[56])(?:$|-)/.test(model) || /^minimax-m3(?:$|-)/.test(model) || /^(?:doubao-)?seed-2[.-][01](?:$|[._-])/.test(model) || /^(?:doubao-)?seed-evolving(?:$|[._-])/.test(model) || /^step-3\.7(?:$|-)/.test(model) || /^mimo-v2\.5(?:$|-)/.test(model) || /^hy3(?:$|-)/.test(model)) {
    return true;
  }
  if (/^deepseek-/.test(model) || /^glm-(?:5(?:$|-)|5\.[123](?:$|[-[])|4\.7(?:$|-)|4\.5-air(?:$|-))/.test(model) || /^qwen3(?:\.[67]-max|[-.]max)(?:$|-)/.test(model) || /^kimi-k2\.7-code(?:$|-)/.test(model) || /^minimax-m2(?:$|[.-])/.test(model) || /^step-3\.5(?:$|-)/.test(model) || /^qianfan-/.test(model) || /^longcat-/.test(model)) {
    return false;
  }
  return null;
}
function getKnownVisionSupport(providerId, modelId) {
  if (KNOWN_NON_VISION_MODELS[providerId]?.has(modelId)) return false;
  if (KNOWN_VISION_MODELS[providerId]?.has(modelId)) return true;
  const modelSupport = getKnownModelVisionSupport(modelId);
  if (modelSupport !== null) return modelSupport;
  if (providerId === "antigravity-oauth") {
    if (/^gemini-/i.test(modelId)) return !/extra-low/i.test(modelId);
    if (/^claude-/i.test(modelId)) return true;
  }
  return null;
}
function getFixedApiFormatForProvider(providerId) {
  switch (providerId) {
    case "default":
      return "anthropic";
    case "gemini":
      return "gemini";
    case "stepfun":
    case "nvidia":
    case "groq":
    case "cerebras":
    case "opencode-go":
    case "zhipu-api":
    case "bailian-api":
    case "volcengine-agent-plan":
    case "volcengine-api":
    case "newmax-gateway":
      return "openai";
    case "opencode-go-anthropic":
      return "anthropic";
    case "gemini-oauth":
      return "gemini";
    case "antigravity-oauth":
      return "antigravity";
    default:
      return null;
  }
}
function getEffectiveApiFormat(provider) {
  const fixed = getFixedApiFormatForProvider(provider.id);
  if (fixed) return fixed;
  return provider.apiFormat || "anthropic";
}
const PROVIDER_SWITCHABLE_BASE_URLS = {
  deepseek: {
    anthropic: "https://api.deepseek.com/anthropic",
    openai: "https://api.deepseek.com"
  },
  moonshot: {
    anthropic: "https://api.moonshot.cn/anthropic",
    openai: "https://api.moonshot.cn/v1"
  },
  zhipu: {
    anthropic: "https://open.bigmodel.cn/api/anthropic",
    openai: "https://open.bigmodel.cn/api/coding/paas/v4"
  },
  minimax: {
    anthropic: "https://api.minimaxi.com/anthropic",
    openai: "https://api.minimaxi.com/v1"
  },
  "minimax-api": {
    anthropic: "https://api.minimaxi.com/anthropic",
    openai: "https://api.minimaxi.com/v1"
  },
  bailian: {
    anthropic: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    openai: "https://coding.dashscope.aliyuncs.com/v1"
  },
  "bailian-token-plan": {
    anthropic: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    openai: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"
  },
  // 火山 Coding Plan 同时提供 Anthropic 与 OpenAI 兼容入口；两者都消耗套餐额度。
  // Agent Plan 与普通按量 API 使用独立 provider preset，避免切格式时误换计费通道。
  volcengine: {
    anthropic: "https://ark.cn-beijing.volces.com/api/coding",
    openai: "https://ark.cn-beijing.volces.com/api/coding/v3"
  },
  openrouter: {
    anthropic: "https://openrouter.ai/api",
    openai: "https://openrouter.ai/api/v1"
  },
  ollama: {
    anthropic: "http://localhost:11434",
    openai: "http://localhost:11434/v1"
  },
  siliconflow: {
    anthropic: "https://api.siliconflow.com/",
    openai: "https://api.siliconflow.com/v1"
  },
  lmstudio: {
    anthropic: "http://localhost:1234",
    openai: "http://localhost:1234/v1"
  }
};
const DEFAULT_ENV_MODELS = [
  "default",
  "sonnet",
  "haiku"
];
const CLAUDE_DEFAULT_ALIASES = /* @__PURE__ */ new Set(["default", "opus", "sonnet", "haiku"]);
const RETIRED_MANUALLY_ADDED_CLAUDE_MODELS = /* @__PURE__ */ new Set(["claude-opus-4-6"]);
function isClaudeDefaultModel(model) {
  if (!model) return false;
  return CLAUDE_DEFAULT_ALIASES.has(model) || model.startsWith("claude-");
}
function orderClaudeModelsByPreference(sdkValues, preferenceOrder) {
  if (!preferenceOrder?.length) return sdkValues;
  const sdkSet = new Set(sdkValues);
  const seen = /* @__PURE__ */ new Set();
  const preferred = [];
  for (const m of preferenceOrder) {
    if (!sdkSet.has(m) || seen.has(m)) continue;
    seen.add(m);
    preferred.push(m);
  }
  const remainder = sdkValues.filter((v) => !seen.has(v));
  return [...preferred, ...remainder];
}
function buildClaudeModelRows(sdkValues, preferenceOrder) {
  const sdkSet = new Set(sdkValues);
  const rows = [];
  const seen = /* @__PURE__ */ new Set();
  for (const v of preferenceOrder ?? []) {
    if (seen.has(v) || !isClaudeDefaultModel(v)) continue;
    if (!sdkSet.has(v) && RETIRED_MANUALLY_ADDED_CLAUDE_MODELS.has(v)) continue;
    seen.add(v);
    rows.push({ value: v, available: sdkSet.has(v) });
  }
  for (const v of sdkValues) {
    if (seen.has(v)) continue;
    seen.add(v);
    rows.push({ value: v, available: true });
  }
  return rows;
}
const MODEL_ID_MIGRATION = {
  "claude-sonnet-4-5": "sonnet",
  "claude-haiku-4-5": "haiku"
};
function enforceModelSelectionIntegrity(selection, providers) {
  const { model, providerId } = selection;
  if (providerId === "default") {
    if (!isClaudeDefaultModel(model)) {
      return { model: "default", providerId: "default" };
    }
    return selection;
  }
  const activeProvider = providers.find((p) => p.id === providerId);
  if (!activeProvider) return { model: "default", providerId: "default" };
  if (providerId === "grok-oauth" && model === "grok-4.5" && !activeProvider.models.includes(model) && activeProvider.models.includes("grok-4.6")) {
    return { model: "grok-4.6", providerId };
  }
  if (!activeProvider.models.includes(model)) return { model: "default", providerId: "default" };
  return selection;
}
const THINKING_BUDGET_VALUES = /* @__PURE__ */ new Set([
  "auto",
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);
function isThinkingBudget(value) {
  return typeof value === "string" && THINKING_BUDGET_VALUES.has(value);
}
function getDefaultFromProviderOrder(settings) {
  const order = settings.providerOrder?.length ? settings.providerOrder : ["default"];
  const userDefaultClaude = settings.defaultClaudeModelOrder?.find(isClaudeDefaultModel);
  const defaultClaudeModel = userDefaultClaude ?? DEFAULT_ENV_MODELS[0];
  for (const id of order) {
    if (id === "default") {
      return { model: defaultClaudeModel, providerId: "default" };
    }
    const provider = settings.providers.find((p) => p.id === id && p.enabled !== false);
    if (!provider) continue;
    const firstModel = provider.enabledModels?.[0] ?? provider.models?.[0];
    if (firstModel) return { model: firstModel, providerId: provider.id };
  }
  return { model: defaultClaudeModel, providerId: "default" };
}
const DEFAULT_PROVIDERS = EDITION_PROVIDER_PRESETS.map((preset) => {
  const baseUrl = typeof preset.settingsConfig.env.ANTHROPIC_BASE_URL === "string" ? preset.settingsConfig.env.ANTHROPIC_BASE_URL : "";
  const models = preset.displayModels || extractModelsFromEnv(preset.settingsConfig.env);
  return {
    id: preset.id,
    name: preset.name,
    apiKey: "",
    baseUrl,
    enabled: false,
    models: models.length > 0 ? models : ["default"],
    modelPresetSnapshot: models.length > 0 ? [...models] : ["default"],
    imageModels: preset.imageModels,
    imageApiProvider: preset.imageApiProvider,
    imageBaseUrl: preset.imageBaseUrl,
    modelContextWindows: preset.modelContextWindows,
    apiKeyUrl: preset.apiKeyUrl,
    canDelete: false,
    apiFormat: preset.apiFormat,
    authType: preset.authType,
    settingsConfig: preset.settingsConfig,
    apiKeyField: preset.apiKeyField,
    category: preset.category,
    hideBaseUrl: preset.hideBaseUrl,
    supportsModelList: preset.supportsModelList,
    note: preset.note,
    requiresProxy: preset.requiresProxy
  };
});
const DOMESTIC_ONLY_PROVIDER_IDS = new Set(
  PROVIDER_PRESETS.filter((preset) => preset.domesticOnly).map((preset) => preset.id)
);
function isPersistedProviderVisibleInEdition(provider, domesticProvidersEnabled = edition.features.domesticProviders) {
  return domesticProvidersEnabled || !DOMESTIC_ONLY_PROVIDER_IDS.has(provider.id);
}
const LEGACY_BUILTIN_MODEL_LISTS = {
  openai: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.3-codex", "gpt-5.4-mini"],
  "openai-oauth": ["gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.5", "gpt-5.2"],
  "grok-oauth": ["grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning", "grok-build-0.1"],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
  minimax: ["MiniMax-M2.7"],
  "minimax-en": ["MiniMax-M2.7"],
  kimi: ["kimi-for-coding"],
  zhipu: ["glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7"],
  zai: ["glm-5.1", "glm-5", "glm-5-turbo", "glm-4.7"],
  bailian: ["qwen3-coder-plus", "qwen3.5-plus", "qwen3-coder-next"],
  "bailian-api": ["qwen3.7-plus", "qwen3-max", "qwen3-coder-plus"],
  volcengine: ["ark-code-latest", "doubao-seed-code-preview-latest", "doubao-seed-2.0-pro", "doubao-1.5-vision-pro"],
  "volcengine-agent-plan": ["doubao-seed-2.0-pro"],
  "volcengine-api": ["doubao-seed-2.0-pro"],
  stepfun: ["step-3.5-flash"],
  bailing: ["Ling-2.6-1T", "Ling-2.6-flash"],
  longcat: ["LongCat-Flash-Chat"],
  xiaomimimo: ["mimo-v2-flash"],
  siliconflow: ["MiniMaxAI/MiniMax-M2.7", "MiniMaxAI/MiniMax-M2.5", "MiniMaxAI/MiniMax-M2.1", "zai-org/GLM-4.7"],
  "siliconflow-cn": ["Pro/MiniMaxAI/MiniMax-M2.7", "Pro/MiniMaxAI/MiniMax-M2.5", "Pro/MiniMaxAI/MiniMax-M2.1"],
  modelscope: ["ZhipuAI/GLM-5", "ZhipuAI/GLM-4.7"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: ["anthropic/claude-sonnet-4.6", "anthropic/claude-haiku-4.5", "anthropic/claude-opus-4.7"],
  "anthropic-channel": ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5-20251001"],
  groq: ["llama-4-scout-17b-16e-instruct", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  cerebras: ["llama-3.3-70b", "qwen-3-235b-a22b-instruct-2507", "gpt-oss-120b"]
};
const LEGACY_BUILTIN_BASE_URLS = {
  bailing: "https://api.tbox.cn/api/anthropic"
};
const PRESET_OWNED_SETTINGS_ENV_PROVIDER_IDS = /* @__PURE__ */ new Set([
  "antigravity-oauth",
  "grok-oauth",
  "zhipu",
  "zai"
]);
const LEGACY_BUILTIN_IMAGE_MODEL_LISTS = {
  openai: ["gpt-image-1.5"]
};
function matchesExactList(value, expected) {
  return Array.isArray(value) && expected !== void 0 && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
function reconcileBuiltinModelPreset(savedModels, previousPresetModels, currentPresetModels) {
  if (savedModels.length === 0) return [...currentPresetModels];
  if (!previousPresetModels || previousPresetModels.length === 0) return [...savedModels];
  if (matchesExactList(savedModels, previousPresetModels)) return [...currentPresetModels];
  const previousSet = new Set(previousPresetModels);
  const currentSet = new Set(currentPresetModels);
  const retained = savedModels.filter((model) => !previousSet.has(model) || currentSet.has(model));
  const retainedSet = new Set(retained);
  const introduced = currentPresetModels.filter(
    (model) => !previousSet.has(model) && !retainedSet.has(model)
  );
  const availableSlots = Math.max(0, MAX_MODELS - retained.length);
  return [...retained, ...introduced.slice(0, availableSlots)];
}
function mergeProviders(persisted) {
  const saved = (Array.isArray(persisted) ? persisted : []).filter((p) => p != null && typeof p === "object" && typeof p.id === "string").filter((p) => p.id !== "gemini-oauth").filter((p) => isPersistedProviderVisibleInEdition(p));
  const savedMap = new Map(saved.map((p) => [p.id, p]));
  const providers = DEFAULT_PROVIDERS.filter(Boolean).map((def) => {
    const s = savedMap.get(def.id);
    if (!s) return { ...def };
    const previousPresetModels = Array.isArray(s.modelPresetSnapshot) ? s.modelPresetSnapshot : def.id === "grok-oauth" && matchesExactList(s.models, ["grok-4.5"]) ? ["grok-4.5"] : LEGACY_BUILTIN_MODEL_LISTS[def.id];
    const shouldMigrateLegacyBaseUrl = s.baseUrl === LEGACY_BUILTIN_BASE_URLS[def.id];
    const mergedModels = reconcileBuiltinModelPreset(
      Array.isArray(s.models) ? s.models : [],
      previousPresetModels,
      def.models
    );
    const mergedModelContextWindows = s.modelContextWindows ? { ...s.modelContextWindows } : def.modelContextWindows ? { ...def.modelContextWindows } : void 0;
    if (mergedModelContextWindows && previousPresetModels) {
      const previousPresetSet = new Set(previousPresetModels);
      for (const model of def.models) {
        if (!previousPresetSet.has(model) && mergedModels.includes(model) && mergedModelContextWindows[model] === void 0 && def.modelContextWindows?.[model] !== void 0) {
          mergedModelContextWindows[model] = def.modelContextWindows[model];
        }
      }
    }
    const savedImageModels = Array.isArray(s.imageModels) ? s.imageModels : void 0;
    const shouldMigrateLegacyImageModels = matchesExactList(
      savedImageModels,
      LEGACY_BUILTIN_IMAGE_MODEL_LISTS[def.id]
    );
    const shouldBackfillGptnbImageDefaults = def.id === "gptnb" && (savedImageModels == null || savedImageModels.length === 0) && (def.imageModels?.length ?? 0) > 0;
    const resolvedImageApiProvider = s.imageApiProvider ?? def.imageApiProvider;
    const supportsAdvertisedAsync = Object.values(s.imageModelCapabilities ?? {}).some((capabilities) => capabilities.requestModes?.includes("async"));
    const shouldPersistImageRequestMode = resolvedImageApiProvider === "dashscope" || resolvedImageApiProvider === "openai" && supportsAdvertisedAsync;
    const hasSettingsConfig = s.settingsConfig?.env && Object.keys(s.settingsConfig.env).length > 0;
    const mergedSettingsConfig = hasSettingsConfig ? PRESET_OWNED_SETTINGS_ENV_PROVIDER_IDS.has(def.id) ? {
      env: {
        ...s.settingsConfig.env,
        ...def.settingsConfig?.env
      }
    } : s.settingsConfig : def.settingsConfig;
    return normalizeProviderCredentialFields({
      ...def,
      apiKey: s.apiKey,
      apiKeys: s.apiKeys,
      apiKeyRotationEnabled: s.apiKeyRotationEnabled,
      oauthAccountRotationEnabled: s.oauthAccountRotationEnabled,
      baseUrl: shouldMigrateLegacyBaseUrl ? def.baseUrl : s.baseUrl ?? def.baseUrl,
      enabled: s.enabled,
      enabledModels: s.enabledModels,
      models: mergedModels,
      modelPresetSnapshot: [...def.models],
      ...Array.isArray(s.modelCatalogSnapshot) ? { modelCatalogSnapshot: [...s.modelCatalogSnapshot] } : {},
      imageModels: shouldBackfillGptnbImageDefaults || shouldMigrateLegacyImageModels ? def.imageModels : savedImageModels ?? def.imageModels,
      imageApiProvider: s.imageApiProvider ?? def.imageApiProvider,
      imageRequestMode: shouldPersistImageRequestMode ? s.imageRequestMode === "sync" || s.imageRequestMode === "async" ? s.imageRequestMode : "auto" : void 0,
      ...s.imageModelCapabilities ? { imageModelCapabilities: s.imageModelCapabilities } : {},
      imageApiKey: typeof s.imageApiKey === "string" ? s.imageApiKey : def.imageApiKey,
      imageBaseUrl: def.id === "gptnb" && (!s.imageBaseUrl || !s.imageBaseUrl.trim()) ? def.imageBaseUrl : typeof s.imageBaseUrl === "string" ? s.imageBaseUrl : def.imageBaseUrl,
      imageDisabled: s.imageDisabled === true,
      apiFormat: s.apiFormat ?? def.apiFormat,
      // authType comes from the code-defined preset (def) — it's a structural field
      // that determines credential acquisition, not something users should change.
      authType: def.authType,
      // Preserve persisted settingsConfig except for the OAuth preset refresh above.
      settingsConfig: mergedSettingsConfig,
      // Capability test results — preserve across rehydrate. 历史上这两个字段被
      // ...def 默默吞掉，导致每次重启 capabilities 丢失，runtime 退回保守透传。
      ...s.capabilities ? { capabilities: s.capabilities } : {},
      ...s.modelCapabilities ? { modelCapabilities: s.modelCapabilities } : {},
      ...mergedModelContextWindows ? { modelContextWindows: mergedModelContextWindows } : {},
      ...s.modelApiIds ? { modelApiIds: s.modelApiIds } : {}
    });
  });
  const builtinIds = new Set(DEFAULT_PROVIDERS.filter(Boolean).map((p) => p.id));
  for (const p of saved) {
    if (!builtinIds.has(p.id)) providers.push(normalizeProviderCredentialFields(p));
  }
  for (const p of providers) {
    p.enabledModels = p.models.slice(0, MAX_MODELS);
  }
  return providers;
}
const SEARCH_PROVIDER_METAS = [
  { id: "tavily", name: "Tavily", description: "AI-optimized search with high-relevance results", apiKeyLabel: "API Key", apiKeyUrl: "https://app.tavily.com/home?utm_source=niumaai", placeholder: "tvly-..." },
  { id: "exa", name: "Exa", description: "Semantic search for academic papers and in-depth content", apiKeyLabel: "API Key", apiKeyUrl: "https://dashboard.exa.ai/api-keys?utm_source=niumaai", placeholder: "exa-..." },
  { id: "brave", name: "Brave Search", description: "Privacy-focused general search with no tracking", apiKeyLabel: "API Key", apiKeyUrl: "https://brave.com/search/api/?utm_source=niumaai", placeholder: "BSA..." },
  { id: "metaso", name: "Metaso", description: "Chinese AI search engine for Chinese-language queries", apiKeyLabel: "API Key", apiKeyUrl: "https://metaso.cn/search-api/api-keys?utm_source=niumaai", placeholder: "mk-..." },
  { id: "doubao", name: "Doubao Search", description: "ByteDance Volcengine web search, direct access in mainland China", apiKeyLabel: "API Key", apiKeyUrl: "https://console.volcengine.com/search-infinity/api-key", placeholder: "" },
  { id: "serpapi", name: "SerpAPI", description: "Google search results API with multiple engines and regions", apiKeyLabel: "API Key", apiKeyUrl: "https://serpapi.com/manage-api-key?utm_source=niumaai", placeholder: "" },
  { id: "serper", name: "Serper", description: "Fast, low-cost Google search API", apiKeyLabel: "API Key", apiKeyUrl: "https://serper.dev/api-key?utm_source=niumaai", placeholder: "" },
  { id: "bing", name: "Bing Search", description: "Microsoft Bing Search", apiKeyLabel: "API Key", apiKeyUrl: "https://www.microsoft.com/en-us/bing/apis/bing-web-search-api?utm_source=niumaai", placeholder: "" },
  { id: "google", name: "Google CSE", description: "Google Custom Search Engine, requires a Search Engine ID", apiKeyLabel: "API Key", apiKeyUrl: "https://programmablesearchengine.google.com/?utm_source=niumaai", placeholder: "" },
  { id: "firecrawl", name: "Firecrawl", description: "Search with structured page extraction", apiKeyLabel: "API Key", apiKeyUrl: "https://www.firecrawl.dev/app/api-keys?utm_source=niumaai", placeholder: "fc-..." }
];
const DEFAULT_SETTINGS = {
  model: "default",
  thinkingBudget: "auto",
  providerId: "default",
  providers: DEFAULT_PROVIDERS,
  providerOrder: ["default"],
  defaultClaudeModelOrder: [...DEFAULT_ENV_MODELS],
  defaultSubagentModel: void 0,
  permissionMode: "full",
  enableBlocklist: true,
  blockedCommands: {
    unix: ["rm -rf /", "rm -rf /*", "chmod 777", "chmod -R 777"],
    windows: ["del /s /q", "rd /s /q", "rmdir /s /q", "format", "diskpart"]
  },
  permissions: [],
  theme: "light",
  colorTheme: "default",
  activeImageThemeId: null,
  customImageThemes: [],
  dismissedPresetImageThemeIds: [],
  imageThemeVariants: {},
  imageThemeBackgroundEffect: "blur",
  randomThemeBg: "#f5f5f0",
  // lint-allow-raw-color — 主题默认值
  randomThemeFg: "#2d4739",
  // lint-allow-raw-color
  randomThemeMood: "crisp",
  customThemePrimary: "#2d4739",
  // lint-allow-raw-color
  customThemeAccent: "#8c7851",
  // lint-allow-raw-color
  customThemePurity: 80,
  customThemeContrast: 50,
  customThemeAutoAdjust: true,
  customThemePrimaryMode: "light",
  showToolUse: true,
  toolCallExpandedByDefault: false,
  collapseExecutionProcess: true,
  chatFontSize: 14,
  useSerifFont: false,
  reduceMotion: false,
  appLanguage: "auto",
  workspaceDirectory: "",
  allowedExportPaths: ["~/Desktop", "~/Downloads"],
  allowedContextPaths: [],
  environmentVariables: "",
  envSnippets: [],
  systemPrompt: "",
  promptEnhancementEnabled: true,
  promptEnhancementShortcutEnabled: true,
  promptEnhancementShortcut: "Tab",
  userName: "",
  userWorkDescription: "",
  slashCommands: [],
  mediaGeneration: {},
  excludedTags: [],
  mcpServers: {},
  localKeepHeavyMcp: false,
  showInMenuBar: true,
  launchAtLogin: true,
  enableNotifications: true,
  notificationSounds: { ...DEFAULT_NOTIFICATION_SOUNDS },
  desktopPetEnabled: false,
  desktopPetId: "black-cat",
  desktopPetScale: 100,
  desktopPetShortcutEnabled: false,
  desktopPetShortcut: "Alt+Shift+P",
  preserveTabsOnQuit: true,
  preventSleepDuringTasks: false,
  agentResourceMode: "auto",
  agentResourceMaxConcurrency: 0,
  agentProcessPriority: "auto",
  agentLimitToolConcurrency: true,
  agentToolConcurrencyLimit: 3,
  agentMaxSubagentsPerConversation: 0,
  skillWorkspaceOptIn: false,
  globalShortcutEnabled: true,
  globalShortcut: "Alt+Space",
  voiceShortcutEnabled: false,
  voiceShortcut: "Fn",
  sidebarArrowShortcutEnabled: true,
  sidebarLeftShortcut: "CommandOrControl+Left",
  sidebarRightShortcut: "CommandOrControl+Right",
  workspaceSwitchShortcutEnabled: true,
  newChatShortcutEnabled: true,
  conversationSearchShortcutEnabled: true,
  closeTabShortcutEnabled: true,
  saveFileShortcutEnabled: true,
  planModeShortcutEnabled: false,
  planModeShortcut: "CommandOrControl+Shift+P",
  goalModeShortcutEnabled: false,
  goalModeShortcut: "CommandOrControl+Shift+G",
  newChatShortcut: "CommandOrControl+N",
  conversationSearchShortcut: "CommandOrControl+K",
  closeTabShortcut: "CommandOrControl+W",
  saveFileShortcut: "CommandOrControl+S",
  workspaceSwitchShortcut: "CommandOrControl+1",
  autoUpdateEnabled: true,
  autoDownloadUpdates: false,
  customUpdateUrl: "",
  backupDirectory: "",
  backupFrequency: "manual",
  lastBackupAt: 0,
  proxyEnabled: false,
  proxyType: "http",
  proxyHost: "",
  proxyPort: "",
  proxyAuth: false,
  proxyUsername: "",
  proxyPassword: "",
  proxyBypass: "",
  customClaudePath: "",
  gitBashPath: "",
  searchProviders: [],
  modelGatewayEnabled: true,
  modelGatewayPort: 0,
  syncClaudeCodeHistory: false,
  autoSaveBrowserWorkflow: true,
  claudeProxyEnabled: false,
  claudeProxyPort: 0,
  failoverEnabled: false,
  failoverQueue: [],
  failoverAutoSwitch: false,
  usageDetailLogging: false,
  providerOnboardingCompleted: false,
  providerOnboardingSkipped: false,
  insightsEnabled: false,
  insightsDailyEnabled: true,
  insightsDailyTime: "08:00",
  insightsDailyModules: { summary: true, missed: true, usage: false, code: false },
  insightsDeepEnabled: false,
  insightsDeepCycle: "weekly",
  insightsDeepDay: 1,
  insightsDeepModules: { roadmap: false, trends: false, research: false },
  insightsModel: "sonnet",
  insightsThinkingBudget: void 0,
  insightsProviderId: "default",
  insightsIncludeCCHistory: false,
  insightsNotifyChannels: [],
  skippedVersions: [],
  lastKnownVersion: ""
};
const ALL_BUILTIN_MCP_SERVERS = {
  // ── 知识 & 文档 ─────────────────────────────────────────
  context7: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Context7 - Current, versioned docs and code examples to reduce stale answers.",
      isBuiltin: true
    }
  },
  "sequential-thinking": {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Sequential Thinking - A step-by-step reasoning workspace for complex analysis and planning.",
      isBuiltin: true
    }
  },
  memory: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Memory - Knowledge-graph memory that preserves entities and relationships across conversations.",
      isBuiltin: true
    }
  },
  // ── 内容 & 网页 ─────────────────────────────────────────
  fetch: {
    type: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Fetch - Retrieves web pages and converts them into readable text for extraction and summaries (requires uv).",
      isBuiltin: true
    }
  },
  firecrawl: {
    type: "stdio",
    command: "npx",
    args: ["-y", "firecrawl-mcp"],
    env: {
      FIRECRAWL_API_KEY: "${FIRECRAWL_API_KEY}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Firecrawl - Structured web crawling and site traversal. Requires FIRECRAWL_API_KEY.",
      isBuiltin: true
    }
  },
  "brave-search": {
    type: "stdio",
    command: "npx",
    args: ["-y", "@anthropic-ai/brave-search-mcp-server"],
    env: {
      BRAVE_API_KEY: "${BRAVE_API_KEY}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Brave Search - Web search through the Brave Search API for current internet information. Requires BRAVE_API_KEY.",
      isBuiltin: true
    }
  },
  // ── 数据库 ──────────────────────────────────────────────
  supabase: {
    type: "http",
    url: "https://mcp.supabase.com/mcp",
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Supabase - Hosted MCP for managing databases, Edge Functions, storage, and more. OAuth required on first use.",
      isBuiltin: true
    }
  },
  mysql: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@benborla29/mcp-server-mysql"],
    env: {
      MYSQL_HOST: "${MYSQL_HOST}",
      MYSQL_PORT: "${MYSQL_PORT}",
      MYSQL_USER: "${MYSQL_USER}",
      MYSQL_PASS: "${MYSQL_PASS}",
      MYSQL_DB: "${MYSQL_DB}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "MySQL - Read, write, inspect schemas, and run SQL against a MySQL database through MCP.",
      isBuiltin: true
    }
  },
  prisma: {
    type: "stdio",
    command: "npx",
    args: ["-y", "prisma", "mcp"],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Prisma - Database migrations, SQL execution, and schema introspection (Prisma CLI v6.6+).",
      isBuiltin: true
    }
  },
  // ── 开发 & 部署 ─────────────────────────────────────────
  filesystem: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Filesystem - Safe file operations such as reading, writing, creating folders, and searching within allowed paths.",
      isBuiltin: true
    }
  },
  vercel: {
    type: "http",
    url: "https://mcp.vercel.com",
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Vercel - Official MCP for managing projects, deployments, and docs. OAuth required on first use.",
      isBuiltin: true
    }
  },
  // ── AI & 模型 ──────────────────────────────────────────
  huggingface: {
    type: "http",
    url: "https://huggingface.co/mcp",
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Hugging Face - Search models, datasets, Spaces, papers, and docs. Sign-in required on first use.",
      isBuiltin: true
    }
  },
  // ── 数据分析 ────────────────────────────────────────────
  metabase: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@cognitionai/metabase-mcp-server"],
    env: {
      METABASE_URL: "${METABASE_URL}",
      METABASE_API_KEY: "${METABASE_API_KEY}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Metabase - Dashboards, cards, databases, and full CRUD operations (81+ tools). Requires METABASE_URL and API key.",
      isBuiltin: true
    }
  },
  // ── 多媒体生成 ──────────────────────────────────────────
  minimax: {
    type: "stdio",
    command: "npx",
    args: ["-y", "minimax-mcp-js"],
    env: {
      MINIMAX_API_KEY: "${MINIMAX_API_KEY}",
      MINIMAX_API_HOST: "${MINIMAX_API_HOST}",
      MINIMAX_MCP_BASE_PATH: "${MINIMAX_MCP_BASE_PATH}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "MiniMax - Multimodal APIs for text-to-speech, voice cloning, video, image, and music generation.",
      isBuiltin: true
    }
  },
  heygen: {
    type: "stdio",
    command: "uvx",
    args: ["heygen-mcp"],
    env: {
      HEYGEN_API_KEY: "${HEYGEN_API_KEY}"
    },
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "HeyGen - AI avatar video generation with avatar management, voice selection, and video creation (requires uv).",
      isBuiltin: true
    }
  },
  // ── 社交媒体 ────────────────────────────────────────────
  xiaohongshu: {
    type: "http",
    url: "http://localhost:18060/mcp",
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "RedNote / Xiaohongshu - Search notes, fetch details, publish posts, and manage comments (requires the local service).",
      isBuiltin: true
    }
  },
  // ── 效率 & 协作 ─────────────────────────────────────────
  notion: {
    type: "http",
    url: "https://mcp.notion.com/mcp",
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Notion - Official MCP for reading and writing pages, databases, comments, and more. OAuth required on first use.",
      isBuiltin: true
    }
  },
  feishu: {
    type: "stdio",
    command: "npx",
    args: [
      "-y",
      "@larksuiteoapi/lark-mcp",
      "mcp",
      "-a",
      "${FEISHU_APP_ID}",
      "-s",
      "${FEISHU_APP_SECRET}"
    ],
    _newmax: {
      enabled: false,
      contextSaving: false,
      description: "Lark / Feishu MCP server - Official SDK access to messaging, cloud docs, calendar, contacts, and more.",
      isBuiltin: true
    }
  }
};
function filterBuiltinMcpCatalogForEdition(catalog, config = edition) {
  const hidden = new Set(config.mcp.hiddenBuiltinServers);
  return Object.fromEntries(
    Object.entries(catalog).filter(([name]) => !hidden.has(name))
  );
}
const BUILTIN_MCP_SERVERS = filterBuiltinMcpCatalogForEdition(ALL_BUILTIN_MCP_SERVERS);
const ALL_BUILTIN_MCP_PACKAGES = {
  context7: "@upstash/context7-mcp",
  "sequential-thinking": "@modelcontextprotocol/server-sequential-thinking",
  memory: "@modelcontextprotocol/server-memory",
  // fetch uses uvx (Python), not npm — skip
  firecrawl: "firecrawl-mcp",
  "brave-search": "@anthropic-ai/brave-search-mcp-server",
  mysql: "@benborla29/mcp-server-mysql",
  prisma: "prisma",
  filesystem: "@modelcontextprotocol/server-filesystem",
  // supabase, vercel, huggingface — remote HTTP, no npm install
  // xiaohongshu — local Go binary, no npm install
  metabase: "@cognitionai/metabase-mcp-server",
  minimax: "minimax-mcp-js",
  // heygen uses uvx (Python), not npm — skip
  feishu: "@larksuiteoapi/lark-mcp"
};
filterBuiltinMcpCatalogForEdition(ALL_BUILTIN_MCP_PACKAGES);
const ALL_BUILTIN_ENV_FIELDS = {
  feishu: [
    { key: "FEISHU_APP_ID", label: "App ID", placeholder: "Enter the Lark / Feishu app ID" },
    { key: "FEISHU_APP_SECRET", label: "App Secret", placeholder: "Enter the Lark / Feishu app secret", type: "password" }
  ],
  firecrawl: [
    { key: "FIRECRAWL_API_KEY", label: "API Key", placeholder: "Enter your Firecrawl API key", type: "password", helpUrl: "https://www.firecrawl.dev/", helpText: "Get a Firecrawl API key" }
  ],
  "brave-search": [
    { key: "BRAVE_API_KEY", label: "API Key", placeholder: "Enter your Brave Search API key", type: "password", helpUrl: "https://brave.com/search/api/", helpText: "Get a Brave Search API key" }
  ],
  mysql: [
    { key: "MYSQL_HOST", label: "Host", placeholder: "127.0.0.1" },
    { key: "MYSQL_PORT", label: "Port", placeholder: "3306" },
    { key: "MYSQL_USER", label: "User", placeholder: "root" },
    { key: "MYSQL_PASS", label: "Password", placeholder: "Enter the database password", type: "password" },
    { key: "MYSQL_DB", label: "Database", placeholder: "Enter the database name" }
  ],
  metabase: [
    { key: "METABASE_URL", label: "Instance URL", placeholder: "https://your-metabase-instance.com", helpUrl: "https://www.metabase.com/docs/latest/people-and-groups/api-keys", helpText: "Learn how to create a Metabase API key" },
    { key: "METABASE_API_KEY", label: "API Key", placeholder: "Enter your Metabase API key", type: "password" }
  ],
  minimax: [
    { key: "MINIMAX_API_KEY", label: "API Key", placeholder: "Enter your MiniMax API key", type: "password", helpUrl: "https://platform.minimax.io/", helpText: "Get a MiniMax API key" },
    { key: "MINIMAX_API_HOST", label: "API base URL", placeholder: "https://api.minimax.io (global) or https://api.minimaxi.com (China)" },
    { key: "MINIMAX_MCP_BASE_PATH", label: "Output directory", placeholder: "Directory for generated files, e.g. /Users/you/Desktop" }
  ],
  heygen: [
    { key: "HEYGEN_API_KEY", label: "API Key", placeholder: "Enter your HeyGen API key", type: "password", helpUrl: "https://www.heygen.com/", helpText: "Get a HeyGen API key" }
  ]
};
filterBuiltinMcpCatalogForEdition(ALL_BUILTIN_ENV_FIELDS);
const AUTO_INSTALL_EXCLUDED_SKILL_NAMES = [
  "公文格式化",
  "document-formatting",
  "document-format",
  "doc-formatting",
  "基础安全机制",
  "security-basics",
  "basic-security",
  "security-review"
];
const AUTO_INSTALL_EXCLUDED_SKILL_DISPLAY_NAMES = [
  "公文格式化",
  "基础安全机制"
];
function getEditionIMPlatforms(config = edition) {
  return config.im.platforms;
}
function canUseOrganizationSettings(config = edition) {
  return config.features.organizationSettings;
}
function canSwitchUILanguage(config = edition) {
  return config.features.languageSwitch;
}
function canUsePersonalEntitlement(config = edition) {
  return config.features.personalEntitlement;
}
function personalEntitlementGateApplies(isGuest, config = edition) {
  return canUsePersonalEntitlement(config) && !isGuest;
}
function canUseWechatMarkdownPreview(config = edition) {
  return config.im.platforms.includes("wechat");
}
function canUseFeishuUpdateDownload(config = edition) {
  return config.im.platforms.includes("feishu");
}
function getEditionProviderCategoryTabs(config = edition) {
  return [
    ...config.providers.showRecommendedCategory ? ["recommended"] : [],
    ...config.providers.visibleCategories
  ];
}
function getEditionProviderCategoryLabelKey(category, fallbackLabelKey, config = edition) {
  if (category === "recommended") return fallbackLabelKey;
  return config.providers.categoryLabelKeys?.[category] ?? fallbackLabelKey;
}
function shouldShowProviderNetworkProxyNotice(config = edition) {
  return config.providers.showNetworkProxyNotice;
}
function isProviderCategoryVisibleInEdition(category, config = edition) {
  return category ? config.providers.visibleCategories.includes(category) : true;
}
function isProviderPresetVisibleInEdition(preset, config = edition) {
  return isProviderVisibleInEdition(preset, config);
}
function filterProviderPresetsForEdition(presets, config = edition) {
  return presets.filter((preset) => isProviderPresetVisibleInEdition(preset, config));
}
function isProviderVisibleInEdition(provider, config = edition, domesticOnlyProviderIds = /* @__PURE__ */ new Set()) {
  if (!config.features.domesticProviders && (provider.domesticOnly || (provider.id ? domesticOnlyProviderIds.has(provider.id) : false))) {
    return false;
  }
  return isProviderCategoryVisibleInEdition(provider.category, config);
}
function getEditionRecommendedProviderPresets(presets, config = edition) {
  const visiblePresets = filterProviderPresetsForEdition(presets, config);
  const explicitIds = getExplicitRecommendationIds(config.providers);
  if (explicitIds.length > 0) {
    const byId = new Map(visiblePresets.map((preset) => [preset.id, preset]));
    return explicitIds.flatMap((id) => {
      const preset = byId.get(id);
      return preset ? [preset] : [];
    });
  }
  return visiblePresets.filter((preset) => preset.recommended).sort((a, b) => (a.recommendedOrder ?? 99) - (b.recommendedOrder ?? 99));
}
function shouldShowClaudeCodeOnboarding(config = edition) {
  return config.providers.showClaudeCodeOnboarding;
}
function shouldUseGatewayFirstOnboarding(config = edition) {
  return config.providers.gatewayFirstOnboarding;
}
function shouldShowProviderOnboarding(config = edition) {
  return config.providers.showProviderOnboarding;
}
function getModelConfigGuideUrl(config = edition) {
  return config.resources.modelConfigGuideUrl;
}
function getClaudeCodeInstallCommands(config = edition) {
  return {
    shell: `curl -fsSL ${config.resources.claudeCodeInstallShUrl} | bash`,
    powershell: `irm ${config.resources.claudeCodeInstallPsUrl} | iex`
  };
}
function getDefenderExclusionPathCommand(config = edition) {
  const dirs = Array.from(/* @__PURE__ */ new Set([config.configDirName, ".newmax", ".niumaai", ".openclaw"]));
  const paths = dirs.map((dir) => `"$env:USERPROFILE\\${dir}"`).join(",");
  return `Add-MpPreference -ExclusionPath ${paths}`;
}
function localizeEditionUrl(url, config = edition) {
  if (config.id !== "intl") return url;
  return url.replace(/([?&]utm_source=)niumaai\b/g, "$1newmaxai");
}
function matchesSkillName(skill, excludedNames) {
  const skillName = skill.name.toLowerCase();
  const displayName = skill.displayName ?? "";
  const nameMatch = excludedNames.some((excluded) => {
    const normalized = excluded.toLowerCase();
    return skillName === normalized || skillName.includes(normalized);
  });
  const displayNameMatch = excludedNames.some(
    (excluded) => !!displayName && (displayName === excluded || displayName.includes(excluded))
  );
  return nameMatch || displayNameMatch;
}
function isSkillVisibleInEdition(skill, config = edition) {
  return !matchesSkillName(skill, config.excludedSkills);
}
function isSkillExcludedFromAutoInstall(skill, config = edition) {
  const excludedNames = [...AUTO_INSTALL_EXCLUDED_SKILL_NAMES, ...config.excludedSkills];
  return matchesSkillName(skill, excludedNames) || matchesSkillName(skill, AUTO_INSTALL_EXCLUDED_SKILL_DISPLAY_NAMES);
}
function isOfflineAppEdition(appEdition = getRuntimeAppEdition()) {
  return appEdition === "offline";
}
function canUseCloudSkillMarket(config = edition, appEdition = getRuntimeAppEdition()) {
  return config.features.skillMarket && !isOfflineAppEdition(appEdition);
}
function canUseSkillCreatorCodes(config = edition, appEdition = getRuntimeAppEdition()) {
  return canUseCloudSkillMarket(config, appEdition);
}
function canPublishSkillToMarket(config = edition, appEdition = getRuntimeAppEdition()) {
  return config.features.skillPublishing && canUseCloudSkillMarket(config, appEdition);
}
function getExplicitRecommendationIds(config) {
  return config.onboardingRecommendedProviderIds ?? [];
}
function getRuntimeAppEdition() {
  return "";
}
const MIN_PET_SCALE_PERCENT = 70;
const MAX_PET_SCALE_PERCENT = 120;
const DEFAULT_PET_SCALE_PERCENT = 100;
const PET_SCALE_STEP_PERCENT = 10;
function normalizePetScalePercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PET_SCALE_PERCENT;
  }
  return Math.max(MIN_PET_SCALE_PERCENT, Math.min(MAX_PET_SCALE_PERCENT, value));
}
function scalePetAtlas(atlas, scalePercent) {
  const multiplier = normalizePetScalePercent(scalePercent) / DEFAULT_PET_SCALE_PERCENT;
  const displayWidth = Math.max(1, Math.round(atlas.displayWidth * multiplier));
  const displayHeight = Math.max(1, Math.round(atlas.displayHeight * multiplier));
  return {
    ...atlas,
    displayWidth,
    displayHeight,
    scale: displayWidth / atlas.cellWidth
  };
}
const BUILTIN_BLACK_CAT_PET_ID = "black-cat";
const BUILTIN_BLACK_CAT_DISPLAY_NAME = "墨瞳";
const BUILTIN_XIAO_MEIQIU_PET_ID = "xiao-meiqiu";
const BUILTIN_XIAO_MEIQIU_DISPLAY_NAME = "Coalball";
const BUILTIN_STARCORN_PET_ID = "starcorn";
const BUILTIN_STARCORN_DISPLAY_NAME = "Starcorn";
const BUILTIN_HOPI_PET_ID = "hopi";
const BUILTIN_HOPI_DISPLAY_NAME = "Hopi";
const BUILTIN_UNI_PET_ID = "uni";
const BUILTIN_UNI_DISPLAY_NAME = "Uni";
const RETIRED_BUILTIN_PET_IDS = /* @__PURE__ */ new Set([
  "adventure-dog",
  "adventure-cat",
  "debug-duck-v2",
  "forest-fox",
  "forest-rabbit"
]);
function normalizePetPackageId(petId) {
  if (!petId) return BUILTIN_BLACK_CAT_PET_ID;
  return RETIRED_BUILTIN_PET_IDS.has(petId) ? BUILTIN_STARCORN_PET_ID : petId;
}
const SETTINGS_PERSIST_VERSION = 6;
function migratePersistedSettings(persistedState, persistedVersion = 0) {
  if (!persistedState || typeof persistedState !== "object") return persistedState;
  const settings = persistedState;
  let migrated = settings;
  if (migrated.colorTheme === "snow-cinnabar") {
    migrated = { ...migrated, colorTheme: "default", activeImageThemeId: null };
  } else if (migrated.colorTheme === "neo") {
    migrated = { ...migrated, colorTheme: normalizeColorThemeId(migrated.colorTheme) };
  }
  if (migrated.activeImageThemeId === "snow-cinnabar") {
    migrated = { ...migrated, activeImageThemeId: null };
  }
  const imageThemeVariants = migrated.imageThemeVariants;
  if (persistedVersion === 3 && migrated.colorTheme === "default" && migrated.activeImageThemeId === DEFAULT_PRESET_IMAGE_THEME_ID && imageThemeVariants?.[DEFAULT_PRESET_IMAGE_THEME_ID] == null) {
    migrated = { ...migrated, activeImageThemeId: null };
  }
  if (persistedVersion < 5 && migrated.agentToolConcurrencyLimit == null && typeof migrated.agentLimitToolConcurrency === "boolean") {
    migrated = {
      ...migrated,
      agentToolConcurrencyLimit: migrated.agentLimitToolConcurrency ? 2 : 4
    };
  }
  if (persistedVersion < 6 && typeof migrated.desktopPetId === "string") {
    const desktopPetId = normalizePetPackageId(migrated.desktopPetId);
    if (desktopPetId !== migrated.desktopPetId) {
      migrated = { ...migrated, desktopPetId };
    }
  }
  return migrated === settings ? persistedState : migrated;
}
const SETTINGS_STORAGE_KEY = "newmax-settings";
const SETTINGS_RESET_BACKUP_KEY = "newmax-settings-reset-backup";
const IMAGE_ROUTE_CONFIG_KEYS = [
  "apiKey",
  "apiKeys",
  "baseUrl",
  "apiFormat",
  "forceResponsesApi",
  "authType",
  "apiKeyField",
  "settingsConfig"
];
function sameProviderConfigValue(left, right) {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
}
function withoutSavedImageRouteResult(capabilities) {
  if (!capabilities || capabilities.image === void 0 && !capabilities.reasons?.image) {
    return capabilities;
  }
  const { image: _image, reasons, ...rest } = capabilities;
  const { image: _imageReason, ...otherReasons } = reasons ?? {};
  return {
    ...rest,
    ...Object.keys(otherReasons).length > 0 ? { reasons: otherReasons } : {}
  };
}
function invalidateSavedImageRouteResults(previous, merged) {
  const routeChanged = IMAGE_ROUTE_CONFIG_KEYS.some(
    (key) => !sameProviderConfigValue(previous[key], merged[key])
  );
  if (!routeChanged) return merged;
  const modelCapabilities = merged.modelCapabilities ? Object.fromEntries(
    Object.entries(merged.modelCapabilities).map(([modelId, capabilities]) => [
      modelId,
      withoutSavedImageRouteResult(capabilities) ?? {}
    ])
  ) : void 0;
  return {
    ...merged,
    capabilities: withoutSavedImageRouteResult(merged.capabilities),
    modelCapabilities
  };
}
function stripRemovedThemeSettings(settings) {
  const { customThemeLightness: legacyCustomThemeLightness, ...supportedSettings } = settings;
  return supportedSettings;
}
function migrateInsightsNotifyChannels(state, visiblePlatforms = getEditionIMPlatforms()) {
  const visibleSet = new Set(visiblePlatforms);
  if (state.insightsNotifyChannels) {
    return state.insightsNotifyChannels.filter((platform) => visibleSet.has(platform));
  }
  return state.insightsNotifyExternal ? [...visiblePlatforms] : [];
}
const mergeBuiltinMcpServers = (mcpServers) => {
  const merged = { ...mcpServers };
  for (const [name, builtinConfig] of Object.entries(BUILTIN_MCP_SERVERS)) {
    if (!merged[name]) {
      merged[name] = builtinConfig;
    } else {
      merged[name] = {
        ...builtinConfig,
        ...merged[name].env && Object.keys(merged[name].env || {}).length > 0 && { env: merged[name].env },
        _newmax: {
          ...builtinConfig._newmax,
          enabled: merged[name]._newmax?.enabled ?? builtinConfig._newmax.enabled,
          contextSaving: merged[name]._newmax?.contextSaving ?? builtinConfig._newmax.contextSaving,
          description: merged[name]._newmax?.description ?? builtinConfig._newmax.description,
          isBuiltin: true
        }
      };
    }
  }
  return merged;
};
const VALID_PERMISSION_MODES = /* @__PURE__ */ new Set(["normal", "yolo", "full"]);
const normalizePermissionMode = (permissionMode) => VALID_PERMISSION_MODES.has(permissionMode) ? permissionMode : DEFAULT_SETTINGS.permissionMode;
const stripActions = (state) => Object.fromEntries(
  Object.entries(state).filter(([_, v]) => typeof v !== "function")
);
const backupSettingsBeforeReset = (state) => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      SETTINGS_RESET_BACKUP_KEY,
      JSON.stringify({
        createdAt: Date.now(),
        storageKey: SETTINGS_STORAGE_KEY,
        value: { state: stripActions(state) }
      })
    );
  } catch (error) {
    console.warn("[Settings] Failed to back up settings before reset:", error);
  }
};
const readSettingsResetBackup = () => {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(SETTINGS_RESET_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.storageKey !== SETTINGS_STORAGE_KEY || typeof parsed.createdAt !== "number" || !parsed.value || typeof parsed.value !== "object" || !parsed.value.state || typeof parsed.value.state !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("[Settings] Failed to read settings reset backup:", error);
    return null;
  }
};
const clearSettingsResetBackup = () => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(SETTINGS_RESET_BACKUP_KEY);
  } catch (error) {
    console.warn("[Settings] Failed to clear settings reset backup:", error);
  }
};
const useSettingsStore = create()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        ...DEFAULT_SETTINGS,
        mcpServers: mergeBuiltinMcpServers(DEFAULT_SETTINGS.mcpServers),
        setModel: (model) => set({ model }),
        setThinkingBudget: (thinkingBudget) => set({ thinkingBudget }),
        setProviderId: (providerId) => set({ providerId }),
        switchProvider: (providerId, model) => set({ providerId, model }),
        enableSmartRouting: (enabled, providerId, model) => set({
          claudeProxyEnabled: enabled,
          failoverEnabled: enabled,
          failoverAutoSwitch: enabled,
          providerId,
          model
        }),
        setProviders: (providers) => set({ providers: providers.map((provider) => normalizeProviderCredentialFields(provider)) }),
        setProviderOrder: (providerOrder) => set((state) => {
          const prevFirstId = (state.providerOrder ?? ["default"])[0] ?? "default";
          const newFirstId = providerOrder[0] ?? "default";
          if (prevFirstId === newFirstId) return { providerOrder };
          if (newFirstId === "default") {
            const userPreferredClaude = state.defaultClaudeModelOrder?.find(
              (m) => typeof m === "string" && isClaudeDefaultModel(m)
            ) ?? "default";
            return {
              providerOrder,
              providerId: "default",
              model: isClaudeDefaultModel(state.model) ? state.model : userPreferredClaude
            };
          }
          const provider = state.providers.find((p) => p.id === newFirstId && p.enabled !== false);
          if (provider) {
            const firstModel = provider.enabledModels?.[0] ?? provider.models?.[0];
            if (firstModel) {
              return { providerOrder, model: firstModel, providerId: provider.id };
            }
          }
          return { providerOrder };
        }),
        setDefaultClaudeModelOrder: (order) => set((state) => {
          const newTop = order.find(isClaudeDefaultModel);
          if (state.providerId === "default" && newTop && newTop !== state.model) {
            return { defaultClaudeModelOrder: order, model: newTop };
          }
          return { defaultClaudeModelOrder: order };
        }),
        setDefaultSubagentModel: (defaultSubagentModel) => set({
          defaultSubagentModel: defaultSubagentModel ?? void 0
        }),
        addProvider: (provider) => set((state) => ({ providers: [...state.providers, normalizeProviderCredentialFields(provider)] })),
        updateProvider: (providerId, updates) => set((state) => ({
          providers: state.providers.filter(Boolean).map((provider) => {
            if (provider.id !== providerId) return provider;
            const rawMerged = { ...provider, ...updates };
            const replacesSingleApiKey = Object.prototype.hasOwnProperty.call(updates, "apiKey") && !Object.prototype.hasOwnProperty.call(updates, "apiKeys");
            const merged = normalizeProviderCredentialFields(
              replacesSingleApiKey ? { ...rawMerged, apiKeys: [updates.apiKey ?? ""] } : rawMerged
            );
            if (updates.models) {
              merged.enabledModels = merged.models.slice(0, MAX_MODELS);
            }
            return invalidateSavedImageRouteResults(
              normalizeProviderCredentialFields(provider),
              merged
            );
          })
        })),
        setProviderModelCapabilities: (providerId, modelId, capabilities) => set((state) => ({
          providers: state.providers.filter(Boolean).map((provider) => {
            if (provider.id !== providerId) return provider;
            const manualOverrides = provider.modelCapabilities?.[modelId]?.manualOverrides;
            return {
              ...provider,
              modelCapabilities: {
                ...provider.modelCapabilities,
                [modelId]: {
                  ...capabilities,
                  ...manualOverrides ? { manualOverrides } : {}
                }
              }
            };
          })
        })),
        setProviderModelCapabilityOverrides: (providerId, modelId, overrides) => set((state) => ({
          providers: state.providers.filter(Boolean).map((provider) => {
            if (provider.id !== providerId) return provider;
            const current = provider.modelCapabilities?.[modelId];
            if (!current && !overrides) return provider;
            const nextCapabilities = { ...current ?? {} };
            if (overrides && Object.keys(overrides).length > 0) {
              nextCapabilities.manualOverrides = overrides;
            } else {
              delete nextCapabilities.manualOverrides;
            }
            const nextModelCapabilities = { ...provider.modelCapabilities ?? {} };
            if (Object.keys(nextCapabilities).length > 0) {
              nextModelCapabilities[modelId] = nextCapabilities;
            } else {
              delete nextModelCapabilities[modelId];
            }
            return {
              ...provider,
              modelCapabilities: Object.keys(nextModelCapabilities).length > 0 ? nextModelCapabilities : void 0
            };
          })
        })),
        removeProvider: (providerId) => set((state) => {
          const isActive = state.providerId === providerId;
          const removesDefaultImageProvider = state.defaultImageProviderId === providerId;
          return {
            providers: state.providers.filter((provider) => provider && provider.id !== providerId),
            providerId: isActive ? "default" : state.providerId,
            defaultImageProviderId: removesDefaultImageProvider ? void 0 : state.defaultImageProviderId,
            imageProviderOrder: (state.imageProviderOrder ?? []).filter((id) => id !== providerId),
            // 删的是 active provider 时，model 可能是仅属于该 provider 的脏值
            // （如 ollama 的 'gemma4:e4b'），必须同步回退到 Claude 默认，
            // 否则 ModelSelector 会显示 Claude logo + 已不存在的模型名。
            model: isActive && !isClaudeDefaultModel(state.model) ? "default" : state.model
          };
        }),
        setTheme: (theme) => {
          set({ theme });
          window.newmax?.app?.setNativeTheme?.(theme);
        },
        setColorTheme: (colorTheme) => set({ colorTheme, activeImageThemeId: null }),
        setImageTheme: (activeImageThemeId) => set({ activeImageThemeId }),
        setImageThemeBackgroundEffect: (imageThemeBackgroundEffect) => set({ imageThemeBackgroundEffect }),
        setImageThemeVariant: (imageThemeId, variant) => set((state) => ({
          activeImageThemeId: imageThemeId,
          imageThemeVariants: { ...state.imageThemeVariants ?? {}, [imageThemeId]: variant }
        })),
        addImageTheme: (imageTheme) => set((state) => ({
          activeImageThemeId: imageTheme.id,
          customImageThemes: [
            ...(state.customImageThemes ?? []).filter((item) => item.id !== imageTheme.id),
            imageTheme
          ]
        })),
        replaceImageTheme: (imageTheme) => set((state) => {
          const themes = state.customImageThemes ?? [];
          if (!themes.some((item) => item.id === imageTheme.id)) return {};
          return {
            customImageThemes: themes.map((item) => item.id === imageTheme.id ? { ...item, ...imageTheme } : item)
          };
        }),
        dismissPresetImageTheme: (presetId) => set((state) => {
          const dismissed = state.dismissedPresetImageThemeIds ?? [];
          if (dismissed.includes(presetId)) return {};
          const nextDismissed = [...dismissed, presetId];
          return {
            dismissedPresetImageThemeIds: nextDismissed,
            // Never leave the app on a wallpaper the user just removed.
            activeImageThemeId: state.activeImageThemeId === presetId ? fallbackImageThemeId(nextDismissed) : state.activeImageThemeId
          };
        }),
        restorePresetImageThemes: () => set({ dismissedPresetImageThemeIds: [] }),
        updateImageTheme: (imageThemeId, updates) => {
          const trimmedName = updates.name.trim();
          if (!trimmedName) return;
          set((state) => ({
            customImageThemes: (state.customImageThemes ?? []).map(
              (item) => item.id === imageThemeId ? {
                ...item,
                name: trimmedName,
                focalPoint: resolveImageThemeFocalPoint(updates.focalPoint)
              } : item
            )
          }));
        },
        removeImageTheme: (imageThemeId) => set((state) => {
          const { [imageThemeId]: _removedVariant, ...imageThemeVariants } = state.imageThemeVariants ?? {};
          return {
            // Deleting the theme in use falls back to the default image theme,
            // not to the color themes — the user stays in wallpaper mode.
            activeImageThemeId: state.activeImageThemeId === imageThemeId ? fallbackImageThemeId(state.dismissedPresetImageThemeIds) : state.activeImageThemeId,
            customImageThemes: (state.customImageThemes ?? []).filter((item) => item.id !== imageThemeId),
            imageThemeVariants
          };
        }),
        setRandomThemeColors: (randomThemeBg, randomThemeFg, randomThemeMood) => set({ randomThemeBg, randomThemeFg, randomThemeMood }),
        setCustomTheme: (customThemePrimary, customThemePurity, customThemeContrast, randomThemeBg, randomThemeFg, customThemeAccent, randomThemeMood, customThemePrimaryMode) => set({
          colorTheme: "custom",
          activeImageThemeId: null,
          customThemePrimary,
          customThemeAccent,
          customThemePurity: Math.max(0, Math.min(100, customThemePurity)),
          customThemeContrast: Math.max(0, Math.min(100, customThemeContrast)),
          customThemePrimaryMode,
          randomThemeBg,
          randomThemeFg,
          randomThemeMood
        }),
        setCustomThemeAutoAdjust: (customThemeAutoAdjust, customThemePrimaryMode) => set({
          colorTheme: "custom",
          activeImageThemeId: null,
          customThemeAutoAdjust,
          customThemePrimaryMode
        }),
        setPermissionMode: (permissionMode) => set({ permissionMode }),
        setShowToolUse: (showToolUse) => set({ showToolUse }),
        setToolCallExpandedByDefault: (toolCallExpandedByDefault) => set({ toolCallExpandedByDefault }),
        setCollapseExecutionProcess: (collapseExecutionProcess) => set({ collapseExecutionProcess }),
        setChatFontSize: (chatFontSize) => set({ chatFontSize: Math.max(13, Math.min(18, chatFontSize)) }),
        setUseSerifFont: (useSerifFont) => set({ useSerifFont }),
        setReduceMotion: (reduceMotion) => {
          set({ reduceMotion });
          document.documentElement.classList.toggle("reduce-motion", reduceMotion);
        },
        setAppLanguage: (appLanguage) => {
          set({ appLanguage });
          void instance.changeLanguage(resolveAppLanguage(appLanguage));
        },
        setSystemPrompt: (systemPrompt) => set({ systemPrompt }),
        setPromptEnhancementEnabled: (promptEnhancementEnabled) => set({ promptEnhancementEnabled }),
        setPromptEnhancementModel: (promptEnhancementModel) => set({
          promptEnhancementModel: promptEnhancementModel ?? void 0
        }),
        setPromptEnhancementShortcutEnabled: (promptEnhancementShortcutEnabled) => set({
          promptEnhancementShortcutEnabled
        }),
        setPromptEnhancementShortcut: (promptEnhancementShortcut) => set({
          promptEnhancementShortcut
        }),
        setUserName: (userName) => set({ userName }),
        setUserWorkDescription: (userWorkDescription) => set({ userWorkDescription }),
        setShowInMenuBar: (showInMenuBar) => set({ showInMenuBar }),
        setLaunchAtLogin: (launchAtLogin) => set({ launchAtLogin }),
        setEnableNotifications: (enableNotifications) => set({ enableNotifications }),
        setNotificationSound: (type, sound) => set((state) => ({
          notificationSounds: {
            ...normalizeNotificationSounds(state.notificationSounds),
            [type]: sound
          }
        })),
        setDesktopPetEnabled: (desktopPetEnabled) => set({ desktopPetEnabled }),
        setDesktopPetId: (desktopPetId) => set({ desktopPetId: normalizePetPackageId(desktopPetId) }),
        setDesktopPetScale: (desktopPetScale) => set({ desktopPetScale: normalizePetScalePercent(desktopPetScale) }),
        setDesktopPetShortcutEnabled: (desktopPetShortcutEnabled) => set({ desktopPetShortcutEnabled }),
        setDesktopPetShortcut: (desktopPetShortcut) => set({ desktopPetShortcut }),
        setPreserveTabsOnQuit: (preserveTabsOnQuit) => set({ preserveTabsOnQuit }),
        setPreventSleepDuringTasks: (preventSleepDuringTasks) => set({ preventSleepDuringTasks }),
        setLocalKeepHeavyMcp: (localKeepHeavyMcp) => set({ localKeepHeavyMcp }),
        setGlobalShortcutEnabled: (globalShortcutEnabled) => set({ globalShortcutEnabled }),
        setGlobalShortcut: (globalShortcut) => set({ globalShortcut }),
        setVoiceShortcutEnabled: (voiceShortcutEnabled) => set({ voiceShortcutEnabled }),
        setVoiceShortcut: (voiceShortcut) => set({ voiceShortcut }),
        setSidebarArrowShortcutEnabled: (sidebarArrowShortcutEnabled) => set({ sidebarArrowShortcutEnabled }),
        setSidebarLeftShortcut: (sidebarLeftShortcut) => set({ sidebarLeftShortcut }),
        setSidebarRightShortcut: (sidebarRightShortcut) => set({ sidebarRightShortcut }),
        setWorkspaceSwitchShortcutEnabled: (workspaceSwitchShortcutEnabled) => set({ workspaceSwitchShortcutEnabled }),
        setNewChatShortcutEnabled: (newChatShortcutEnabled) => set({ newChatShortcutEnabled }),
        setConversationSearchShortcutEnabled: (conversationSearchShortcutEnabled) => set({ conversationSearchShortcutEnabled }),
        setCloseTabShortcutEnabled: (closeTabShortcutEnabled) => set({ closeTabShortcutEnabled }),
        setSaveFileShortcutEnabled: (saveFileShortcutEnabled) => set({ saveFileShortcutEnabled }),
        setPlanModeShortcutEnabled: (planModeShortcutEnabled) => set({ planModeShortcutEnabled }),
        setPlanModeShortcut: (planModeShortcut) => set({ planModeShortcut }),
        setGoalModeShortcutEnabled: (goalModeShortcutEnabled) => set({ goalModeShortcutEnabled }),
        setGoalModeShortcut: (goalModeShortcut) => set({ goalModeShortcut }),
        setNewChatShortcut: (newChatShortcut) => set({ newChatShortcut }),
        setConversationSearchShortcut: (conversationSearchShortcut) => set({ conversationSearchShortcut }),
        setCloseTabShortcut: (closeTabShortcut) => set({ closeTabShortcut }),
        setSaveFileShortcut: (saveFileShortcut) => set({ saveFileShortcut }),
        setWorkspaceSwitchShortcut: (workspaceSwitchShortcut) => set({ workspaceSwitchShortcut }),
        setAutoUpdateEnabled: (autoUpdateEnabled) => set({ autoUpdateEnabled }),
        setAutoDownloadUpdates: (autoDownloadUpdates) => set({ autoDownloadUpdates }),
        setCustomUpdateUrl: (customUpdateUrl) => set({ customUpdateUrl }),
        setBackupDirectory: (backupDirectory) => set({ backupDirectory }),
        setBackupFrequency: (backupFrequency) => set({ backupFrequency }),
        setLastBackupAt: (lastBackupAt) => set({ lastBackupAt }),
        // Any user-driven change to a proxy field clears the auto-detected source
        // marker — once the user touches it, we treat the value as user-owned and
        // stop showing the "已自动检测" badge.
        setProxyEnabled: (proxyEnabled) => set({
          proxyEnabled,
          proxyAutoDetectedSource: void 0,
          // Sticky：用户主动关代理 → 标记，settings:load 不再 auto-detect 把它开回来。
          // 主动开回来 → 清掉标记。
          proxyManuallyDisabled: proxyEnabled ? void 0 : true
        }),
        setProxyType: (proxyType) => set({ proxyType, proxyAutoDetectedSource: void 0 }),
        setProxyHost: (proxyHost) => set({ proxyHost, proxyAutoDetectedSource: void 0 }),
        setProxyPort: (proxyPort) => set({ proxyPort, proxyAutoDetectedSource: void 0 }),
        setProxyAuth: (proxyAuth) => set({ proxyAuth, proxyAutoDetectedSource: void 0 }),
        setProxyUsername: (proxyUsername) => set({ proxyUsername, proxyAutoDetectedSource: void 0 }),
        setProxyPassword: (proxyPassword) => set({ proxyPassword, proxyAutoDetectedSource: void 0 }),
        setProxyBypass: (proxyBypass) => set({ proxyBypass, proxyAutoDetectedSource: void 0 }),
        setCustomClaudePath: (customClaudePath) => set({ customClaudePath }),
        setSearchProviders: (searchProviders) => set({ searchProviders }),
        updateSearchProvider: (id, updates) => set((state) => ({
          searchProviders: (state.searchProviders || []).map(
            (sp) => sp.id === id ? { ...sp, ...updates } : sp
          )
        })),
        addSearchProvider: (setting) => set((state) => ({
          searchProviders: [...state.searchProviders || [], setting]
        })),
        removeSearchProvider: (id) => set((state) => ({
          searchProviders: (state.searchProviders || []).filter((sp) => sp.id !== id)
        })),
        setModelGatewayEnabled: (modelGatewayEnabled) => set({ modelGatewayEnabled }),
        setModelGatewayPort: (modelGatewayPort) => set({ modelGatewayPort }),
        setSyncClaudeCodeHistory: (syncClaudeCodeHistory) => set({ syncClaudeCodeHistory }),
        setAutoSaveBrowserWorkflow: (autoSaveBrowserWorkflow) => set({ autoSaveBrowserWorkflow }),
        setClaudeProxyEnabled: (claudeProxyEnabled) => set({ claudeProxyEnabled }),
        setClaudeProxyPort: (claudeProxyPort) => set({ claudeProxyPort }),
        setFailoverEnabled: (failoverEnabled) => set({ failoverEnabled }),
        setFailoverQueue: (failoverQueue) => set({ failoverQueue }),
        setFailoverAutoSwitch: (failoverAutoSwitch) => set({ failoverAutoSwitch }),
        setUsageDetailLogging: (usageDetailLogging) => set({ usageDetailLogging }),
        // Provider onboarding
        setProviderOnboardingCompleted: (providerOnboardingCompleted) => set({ providerOnboardingCompleted }),
        setProviderOnboardingSkipped: (providerOnboardingSkipped) => set({ providerOnboardingSkipped }),
        // AI Insights
        setInsightsEnabled: (insightsEnabled) => set({ insightsEnabled }),
        setInsightsDailyEnabled: (insightsDailyEnabled) => set({ insightsDailyEnabled }),
        setInsightsDailyTime: (insightsDailyTime) => set({ insightsDailyTime }),
        setInsightsDailyModules: (insightsDailyModules) => set({ insightsDailyModules }),
        setInsightsDeepEnabled: (insightsDeepEnabled) => set({ insightsDeepEnabled }),
        setInsightsDeepCycle: (insightsDeepCycle) => set({ insightsDeepCycle }),
        setInsightsDeepDay: (insightsDeepDay) => set({ insightsDeepDay }),
        setInsightsDeepModules: (insightsDeepModules) => set({ insightsDeepModules }),
        setInsightsModel: (insightsModel, providerId) => set((state) => ({
          insightsModel,
          ...providerId !== void 0 ? { insightsProviderId: providerId } : {},
          insightsThinkingBudget: state.insightsThinkingBudget ?? state.thinkingBudget
        })),
        setInsightsThinkingBudget: (insightsThinkingBudget) => set({ insightsThinkingBudget }),
        setInsightsIncludeCCHistory: (insightsIncludeCCHistory) => set({ insightsIncludeCCHistory }),
        setInsightsNotifyChannels: (insightsNotifyChannels) => set({ insightsNotifyChannels }),
        skipVersion: (version) => set((state) => ({
          skippedVersions: [.../* @__PURE__ */ new Set([...state.skippedVersions, version])]
        })),
        setLastKnownVersion: (lastKnownVersion) => set({ lastKnownVersion }),
        setVisionFallback: (visionFallback) => set({ visionFallback: visionFallback ?? void 0 }),
        setVisionFallbackEnabled: (visionFallbackEnabled) => set({ visionFallbackEnabled }),
        setDefaultImageProviderId: (defaultImageProviderId) => set({
          defaultImageProviderId: defaultImageProviderId?.trim() || void 0
        }),
        setImageProviderOrder: (imageProviderOrder) => set({
          imageProviderOrder,
          defaultImageProviderId: imageProviderOrder[0] || void 0
        }),
        setPlanExecModelEnabled: (planExecModelEnabled) => set({ planExecModelEnabled }),
        setPlanModel: (planModel) => set({ planModel: planModel ?? void 0 }),
        setExecutionModel: (executionModel) => set({ executionModel: executionModel ?? void 0 }),
        addToFailoverQueue: (providerId) => set((state) => {
          const existing = state.failoverQueue || [];
          if (existing.some((e) => e.providerId === providerId)) return state;
          const maxIndex = existing.reduce((max, e) => Math.max(max, e.sortIndex), -1);
          return {
            failoverQueue: [...existing, { providerId, sortIndex: maxIndex + 1, enabled: true }]
          };
        }),
        removeFromFailoverQueue: (providerId) => set((state) => ({
          failoverQueue: (state.failoverQueue || []).filter((e) => e.providerId !== providerId)
        })),
        reorderFailoverQueue: (fromIndex, toIndex) => set((state) => {
          const queue = [...state.failoverQueue || []].sort((a, b) => a.sortIndex - b.sortIndex);
          if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length) return state;
          const [moved] = queue.splice(fromIndex, 1);
          queue.splice(toIndex, 0, moved);
          return {
            failoverQueue: queue.map((entry, i) => ({ ...entry, sortIndex: i }))
          };
        }),
        promoteFailoverProvider: (providerId) => set((state) => {
          const queue = [...state.failoverQueue || []].sort((a, b) => a.sortIndex - b.sortIndex);
          const idx = queue.findIndex((e) => e.providerId === providerId);
          if (idx <= 0) return state;
          const [moved] = queue.splice(idx, 1);
          queue.unshift(moved);
          return {
            failoverQueue: queue.map((entry, i) => ({ ...entry, sortIndex: i }))
          };
        }),
        hasSettingsResetBackup: () => readSettingsResetBackup() !== null,
        restoreSettingsResetBackup: () => {
          const backup = readSettingsResetBackup();
          if (!backup) return false;
          set((state) => {
            const restored = backup.value.state;
            return {
              ...state,
              ...restored,
              providers: Array.isArray(restored.providers) ? mergeProviders(restored.providers) : state.providers,
              mcpServers: mergeBuiltinMcpServers(
                restored.mcpServers || state.mcpServers || DEFAULT_SETTINGS.mcpServers
              )
            };
          });
          clearSettingsResetBackup();
          return true;
        },
        clearSettingsResetBackup,
        resetSettings: () => {
          const current = get();
          backupSettingsBeforeReset(current);
          set({
            ...DEFAULT_SETTINGS,
            mcpServers: mergeBuiltinMcpServers(DEFAULT_SETTINGS.mcpServers),
            // 这是 onboarding 流程状态，不是用户可配置项。恢复默认设置不能把用户
            // 重新挡回配置向导，否则 Skill 管理等主界面入口会变得不可达。
            providerOnboardingCompleted: current.providerOnboardingCompleted,
            providerOnboardingSkipped: current.providerOnboardingSkipped
          });
        },
        updateSettings: (settings) => set((state) => ({
          ...state,
          ...settings,
          ...settings.colorTheme ? { colorTheme: normalizeColorThemeId(settings.colorTheme) } : {},
          desktopPetScale: normalizePetScalePercent(settings.desktopPetScale ?? state.desktopPetScale),
          ...settings.providers ? { providers: mergeProviders(settings.providers) } : {},
          ...settings.mcpServers ? { mcpServers: mergeBuiltinMcpServers(settings.mcpServers) } : {}
        })),
        addMcpServer: (name, config) => {
          set((state) => {
            if (BUILTIN_MCP_SERVERS[name]) {
              console.warn(`[Settings] Cannot override built-in MCP server: ${name}`);
              return state;
            }
            return {
              mcpServers: {
                ...state.mcpServers,
                [name]: config
              }
            };
          });
        },
        updateMcpServer: (name, config) => {
          set((state) => {
            const existing = state.mcpServers[name];
            if (!existing) return state;
            const isBuiltin = existing._newmax?.isBuiltin || BUILTIN_MCP_SERVERS[name];
            if (isBuiltin) {
              const builtinConfig = BUILTIN_MCP_SERVERS[name];
              return {
                mcpServers: {
                  ...state.mcpServers,
                  [name]: {
                    ...builtinConfig,
                    ...config.env && { env: config.env },
                    _newmax: {
                      ...builtinConfig._newmax,
                      enabled: config._newmax?.enabled ?? existing._newmax?.enabled ?? builtinConfig._newmax.enabled,
                      contextSaving: config._newmax?.contextSaving ?? existing._newmax?.contextSaving ?? builtinConfig._newmax.contextSaving,
                      isBuiltin: true
                    }
                  }
                }
              };
            }
            return {
              mcpServers: {
                ...state.mcpServers,
                [name]: { ...existing, ...config }
              }
            };
          });
        },
        removeMcpServer: (name) => {
          set((state) => {
            const server = state.mcpServers[name];
            if (server?._newmax?.isBuiltin || BUILTIN_MCP_SERVERS[name]) {
              console.warn(`[Settings] Cannot remove built-in MCP server: ${name}`);
              return state;
            }
            const { [name]: removed, ...rest } = state.mcpServers;
            return { mcpServers: rest };
          });
        },
        saveMcpConfigToFile: async () => {
          const state = get();
          try {
            const config = {
              mcpServers: {}
            };
            for (const [name, serverConfig] of Object.entries(state.mcpServers || {})) {
              const isBuiltin = serverConfig._newmax?.isBuiltin || BUILTIN_MCP_SERVERS[name];
              if (isBuiltin) {
                config.mcpServers[name] = {
                  _newmax: {
                    enabled: serverConfig._newmax?.enabled ?? false,
                    contextSaving: serverConfig._newmax?.contextSaving ?? false,
                    description: serverConfig._newmax?.description,
                    isBuiltin: true
                  },
                  ...serverConfig.env && Object.keys(serverConfig.env).length > 0 && { env: serverConfig.env }
                };
              } else {
                config.mcpServers[name] = {
                  type: serverConfig.type,
                  ...serverConfig.command && { command: serverConfig.command },
                  ...serverConfig.args && serverConfig.args.length > 0 && { args: serverConfig.args },
                  ...serverConfig.env && Object.keys(serverConfig.env).length > 0 && { env: serverConfig.env },
                  ...serverConfig.url && { url: serverConfig.url },
                  ...serverConfig.headers && Object.keys(serverConfig.headers).length > 0 && { headers: serverConfig.headers },
                  ...serverConfig._newmax && { _newmax: serverConfig._newmax }
                };
              }
            }
            const result = await window.newmax?.mcp?.save?.(config);
            if (!result?.success) {
              console.error("[Settings] Failed to save MCP config:", result?.error);
            }
          } catch (error) {
            console.error("[Settings] Failed to save MCP config:", error);
          }
        }
      }),
      {
        name: SETTINGS_STORAGE_KEY,
        version: SETTINGS_PERSIST_VERSION,
        migrate: (persistedState, persistedVersion) => migratePersistedSettings(persistedState, persistedVersion),
        partialize: (state) => stripActions(state),
        merge: (persistedState, currentState) => {
          const persistedSettings = persistedState;
          const supportedPersistedSettings = stripRemovedThemeSettings(persistedSettings);
          const merged = { ...currentState, ...supportedPersistedSettings };
          const providers = mergeProviders(merged.providers);
          const mcpServers = mergeBuiltinMcpServers(merged.mcpServers || {});
          const permissionMode = normalizePermissionMode(merged.permissionMode);
          const migratedModel = MODEL_ID_MIGRATION[merged.model] || merged.model;
          const enforced = enforceModelSelectionIntegrity(
            { providerId: typeof merged.providerId === "string" ? merged.providerId : "default", model: migratedModel },
            providers
          );
          const providerId = enforced.providerId;
          let model = enforced.model;
          if (providerId === "default") {
            const order = Array.isArray(merged.defaultClaudeModelOrder) ? merged.defaultClaudeModelOrder : [];
            const userTop = order.find((m) => typeof m === "string" && isClaudeDefaultModel(m));
            if (userTop && userTop !== model) {
              model = userTop;
            }
          }
          if (merged.reduceMotion) {
            document.documentElement.classList.add("reduce-motion");
          }
          window.newmax?.app?.setNativeTheme?.(merged.theme ?? "system")?.catch?.(() => {
          });
          return {
            ...merged,
            colorTheme: normalizeColorThemeId(merged.colorTheme),
            activeImageThemeId: typeof merged.activeImageThemeId === "string" ? merged.activeImageThemeId : null,
            customImageThemes: Array.isArray(merged.customImageThemes) ? merged.customImageThemes : [],
            promptEnhancementModel: merged.promptEnhancementModel ? {
              ...merged.promptEnhancementModel,
              thinkingBudget: merged.promptEnhancementModel.thinkingBudget ?? merged.thinkingBudget
            } : void 0,
            insightsThinkingBudget: merged.insightsThinkingBudget ?? merged.thinkingBudget,
            model,
            permissionMode,
            notificationSounds: normalizeNotificationSounds(merged.notificationSounds),
            desktopPetScale: normalizePetScalePercent(merged.desktopPetScale),
            providers,
            providerId,
            defaultImageProviderId: typeof merged.defaultImageProviderId === "string" && providers.some((provider) => provider.id === merged.defaultImageProviderId) ? merged.defaultImageProviderId : void 0,
            imageProviderOrder: Array.isArray(merged.imageProviderOrder) ? merged.imageProviderOrder.filter(
              (id) => typeof id === "string" && providers.some((provider) => provider.id === id)
            ) : void 0,
            mcpServers
          };
        }
      }
    )
  )
);
const selectSettingsSnapshot = (state) => ({
  model: state.model,
  thinkingBudget: state.thinkingBudget,
  providerId: state.providerId || "default",
  providers: Array.isArray(state.providers) ? state.providers : DEFAULT_PROVIDERS,
  providerOrder: state.providerOrder ?? ["default"],
  defaultClaudeModelOrder: Array.isArray(state.defaultClaudeModelOrder) && state.defaultClaudeModelOrder.length > 0 ? state.defaultClaudeModelOrder : [...DEFAULT_SETTINGS.defaultClaudeModelOrder],
  defaultSubagentModel: state.defaultSubagentModel,
  theme: state.theme,
  colorTheme: state.colorTheme,
  activeImageThemeId: state.activeImageThemeId ?? null,
  customImageThemes: state.customImageThemes ?? [],
  dismissedPresetImageThemeIds: state.dismissedPresetImageThemeIds ?? [],
  imageThemeVariants: state.imageThemeVariants ?? {},
  imageThemeBackgroundEffect: state.imageThemeBackgroundEffect ?? DEFAULT_SETTINGS.imageThemeBackgroundEffect,
  randomThemeBg: state.randomThemeBg ?? "#f5f5f0",
  // lint-allow-raw-color
  randomThemeFg: state.randomThemeFg ?? "#2d4739",
  // lint-allow-raw-color
  randomThemeMood: state.randomThemeMood ?? "crisp",
  customThemePrimary: state.customThemePrimary ?? "#2d4739",
  // lint-allow-raw-color
  customThemeAccent: state.customThemeAccent ?? "#8c7851",
  // lint-allow-raw-color
  customThemePurity: state.customThemePurity ?? 80,
  customThemeContrast: state.customThemeContrast ?? 50,
  customThemeAutoAdjust: state.customThemeAutoAdjust ?? true,
  customThemePrimaryMode: state.customThemePrimaryMode ?? "light",
  permissionMode: normalizePermissionMode(state.permissionMode),
  enableBlocklist: state.enableBlocklist,
  blockedCommands: state.blockedCommands,
  permissions: state.permissions,
  showToolUse: state.showToolUse,
  toolCallExpandedByDefault: state.toolCallExpandedByDefault,
  collapseExecutionProcess: state.collapseExecutionProcess ?? DEFAULT_SETTINGS.collapseExecutionProcess,
  chatFontSize: state.chatFontSize ?? 14,
  useSerifFont: state.useSerifFont ?? false,
  reduceMotion: state.reduceMotion ?? false,
  appLanguage: state.appLanguage ?? "auto",
  workspaceDirectory: state.workspaceDirectory ?? "",
  allowedExportPaths: state.allowedExportPaths,
  allowedContextPaths: state.allowedContextPaths,
  environmentVariables: state.environmentVariables,
  envSnippets: state.envSnippets,
  systemPrompt: state.systemPrompt,
  promptEnhancementEnabled: state.promptEnhancementEnabled ?? DEFAULT_SETTINGS.promptEnhancementEnabled,
  promptEnhancementModel: state.promptEnhancementModel,
  promptEnhancementShortcutEnabled: state.promptEnhancementShortcutEnabled ?? DEFAULT_SETTINGS.promptEnhancementShortcutEnabled,
  promptEnhancementShortcut: state.promptEnhancementShortcut ?? DEFAULT_SETTINGS.promptEnhancementShortcut,
  userName: state.userName,
  userWorkDescription: state.userWorkDescription,
  slashCommands: state.slashCommands,
  mediaGeneration: state.mediaGeneration,
  excludedTags: state.excludedTags,
  mcpServers: state.mcpServers,
  localKeepHeavyMcp: state.localKeepHeavyMcp ?? false,
  showInMenuBar: state.showInMenuBar,
  launchAtLogin: state.launchAtLogin,
  enableNotifications: state.enableNotifications,
  notificationSounds: normalizeNotificationSounds(state.notificationSounds),
  desktopPetEnabled: state.desktopPetEnabled ?? false,
  desktopPetId: normalizePetPackageId(state.desktopPetId),
  desktopPetScale: normalizePetScalePercent(state.desktopPetScale),
  desktopPetShortcutEnabled: state.desktopPetShortcutEnabled ?? false,
  desktopPetShortcut: state.desktopPetShortcut ?? "Alt+Shift+P",
  preserveTabsOnQuit: state.preserveTabsOnQuit ?? true,
  preventSleepDuringTasks: state.preventSleepDuringTasks ?? false,
  agentResourceMode: state.agentResourceMode ?? "auto",
  agentResourceMaxConcurrency: state.agentResourceMaxConcurrency ?? 0,
  agentProcessPriority: state.agentProcessPriority ?? "auto",
  agentLimitToolConcurrency: state.agentLimitToolConcurrency ?? true,
  agentToolConcurrencyLimit: state.agentToolConcurrencyLimit ?? 3,
  agentMaxSubagentsPerConversation: state.agentMaxSubagentsPerConversation ?? 0,
  skillWorkspaceOptIn: state.skillWorkspaceOptIn ?? false,
  globalShortcutEnabled: state.globalShortcutEnabled,
  globalShortcut: state.globalShortcut,
  voiceShortcutEnabled: state.voiceShortcutEnabled,
  voiceShortcut: state.voiceShortcut,
  sidebarArrowShortcutEnabled: state.sidebarArrowShortcutEnabled ?? true,
  sidebarLeftShortcut: state.sidebarLeftShortcut ?? "CommandOrControl+Left",
  sidebarRightShortcut: state.sidebarRightShortcut ?? "CommandOrControl+Right",
  workspaceSwitchShortcutEnabled: state.workspaceSwitchShortcutEnabled ?? true,
  newChatShortcutEnabled: state.newChatShortcutEnabled ?? true,
  conversationSearchShortcutEnabled: state.conversationSearchShortcutEnabled ?? true,
  closeTabShortcutEnabled: state.closeTabShortcutEnabled ?? true,
  saveFileShortcutEnabled: state.saveFileShortcutEnabled ?? true,
  planModeShortcutEnabled: state.planModeShortcutEnabled ?? false,
  planModeShortcut: state.planModeShortcut ?? "CommandOrControl+Shift+P",
  goalModeShortcutEnabled: state.goalModeShortcutEnabled ?? false,
  goalModeShortcut: state.goalModeShortcut ?? "CommandOrControl+Shift+G",
  newChatShortcut: state.newChatShortcut ?? "CommandOrControl+N",
  conversationSearchShortcut: state.conversationSearchShortcut ?? "CommandOrControl+K",
  closeTabShortcut: state.closeTabShortcut ?? "CommandOrControl+W",
  saveFileShortcut: state.saveFileShortcut ?? "CommandOrControl+S",
  workspaceSwitchShortcut: state.workspaceSwitchShortcut ?? "CommandOrControl+1",
  autoUpdateEnabled: state.autoUpdateEnabled,
  autoDownloadUpdates: state.autoDownloadUpdates,
  customUpdateUrl: state.customUpdateUrl,
  backupDirectory: state.backupDirectory,
  backupFrequency: state.backupFrequency,
  lastBackupAt: state.lastBackupAt,
  proxyEnabled: state.proxyEnabled,
  proxyType: state.proxyType,
  proxyHost: state.proxyHost,
  proxyPort: state.proxyPort,
  proxyAuth: state.proxyAuth,
  proxyUsername: state.proxyUsername,
  proxyPassword: state.proxyPassword,
  proxyBypass: state.proxyBypass ?? "",
  proxyAutoDetectedSource: state.proxyAutoDetectedSource,
  proxyManuallyDisabled: state.proxyManuallyDisabled,
  customClaudePath: state.customClaudePath,
  gitBashPath: state.gitBashPath ?? "",
  searchProviders: state.searchProviders || [],
  modelGatewayEnabled: state.modelGatewayEnabled ?? false,
  modelGatewayPort: state.modelGatewayPort ?? 0,
  syncClaudeCodeHistory: state.syncClaudeCodeHistory ?? false,
  autoSaveBrowserWorkflow: state.autoSaveBrowserWorkflow ?? true,
  claudeProxyEnabled: state.claudeProxyEnabled ?? false,
  claudeProxyPort: state.claudeProxyPort ?? 0,
  failoverEnabled: state.failoverEnabled ?? false,
  failoverQueue: state.failoverQueue ?? [],
  failoverAutoSwitch: state.failoverAutoSwitch ?? false,
  usageDetailLogging: state.usageDetailLogging ?? false,
  providerOnboardingCompleted: state.providerOnboardingCompleted ?? false,
  providerOnboardingSkipped: state.providerOnboardingSkipped ?? false,
  // AI Insights defaults
  insightsEnabled: state.insightsEnabled ?? false,
  insightsDailyEnabled: state.insightsDailyEnabled ?? true,
  insightsDailyTime: state.insightsDailyTime ?? "08:00",
  insightsDailyModules: state.insightsDailyModules ?? { summary: true, missed: true, usage: false, code: false },
  insightsDeepEnabled: state.insightsDeepEnabled ?? false,
  insightsDeepCycle: state.insightsDeepCycle ?? "weekly",
  insightsDeepDay: state.insightsDeepDay ?? 1,
  insightsDeepModules: state.insightsDeepModules ?? { roadmap: false, trends: false, research: false },
  insightsModel: state.insightsModel ?? "sonnet",
  insightsThinkingBudget: state.insightsThinkingBudget,
  insightsProviderId: state.insightsProviderId ?? "default",
  insightsIncludeCCHistory: state.insightsIncludeCCHistory ?? false,
  insightsNotifyChannels: migrateInsightsNotifyChannels(state),
  skippedVersions: state.skippedVersions ?? [],
  lastKnownVersion: state.lastKnownVersion ?? "",
  visionFallback: state.visionFallback,
  visionFallbackEnabled: state.visionFallbackEnabled ?? true,
  defaultImageProviderId: state.defaultImageProviderId,
  imageProviderOrder: state.imageProviderOrder,
  planExecModelEnabled: state.planExecModelEnabled ?? false,
  planModel: state.planModel,
  executionModel: state.executionModel
});
export {
  normalizePetPackageId as $,
  getKnownModelVisionSupport as A,
  BUILTIN_UNI_PET_ID as B,
  isOfflineAppEdition as C,
  DEFAULT_SETTINGS as D,
  canUsePersonalEntitlement as E,
  getEditionIMPlatforms as F,
  getEffectiveModelContextWindows as G,
  getReliableImageCapability as H,
  getKnownVisionSupport as I,
  canUseWechatMarkdownPreview as J,
  getDefenderExclusionPathCommand as K,
  getClaudeCodeInstallCommands as L,
  MAX_MODELS as M,
  getEditionProviderCategoryTabs as N,
  getEditionProviderCategoryLabelKey as O,
  PROVIDER_PRESETS as P,
  filterProviderPresetsForEdition as Q,
  shouldShowProviderNetworkProxyNotice as R,
  isProviderVisibleInEdition as S,
  buildClaudeModelRows as T,
  normalizeProviderApiKeys as U,
  PROVIDER_SWITCHABLE_BASE_URLS as V,
  isThinkingBudget as W,
  SEARCH_PROVIDER_METAS as X,
  canUseFeishuUpdateDownload as Y,
  getModelConfigGuideUrl as Z,
  canSwitchUILanguage as _,
  getEffectiveApiFormat as a,
  PET_SCALE_STEP_PERCENT as a0,
  MAX_PET_SCALE_PERCENT as a1,
  MIN_PET_SCALE_PERCENT as a2,
  BUILTIN_BLACK_CAT_DISPLAY_NAME as a3,
  normalizeNotificationSounds as a4,
  BUILTIN_NOTIFICATION_SOUND_IDS as a5,
  NOTIFICATION_SOUND_LABELS as a6,
  BUILTIN_XIAO_MEIQIU_DISPLAY_NAME as a7,
  BUILTIN_STARCORN_DISPLAY_NAME as a8,
  BUILTIN_HOPI_DISPLAY_NAME as a9,
  BUILTIN_UNI_DISPLAY_NAME as aa,
  canUseCloudSkillMarket as ab,
  canUseSkillCreatorCodes as ac,
  canPublishSkillToMarket as ad,
  personalEntitlementGateApplies as ae,
  shouldShowProviderOnboarding as af,
  isSkillExcludedFromAutoInstall as ag,
  scalePetAtlas as b,
  BUILTIN_HOPI_PET_ID as c,
  BUILTIN_STARCORN_PET_ID as d,
  BUILTIN_XIAO_MEIQIU_PET_ID as e,
  BUILTIN_BLACK_CAT_PET_ID as f,
  getModelCapabilities as g,
  getDefaultFromProviderOrder as h,
  isClaudeDefaultModel as i,
  isSkillVisibleInEdition as j,
  DEFAULT_ENV_MODELS as k,
  DEFAULT_PROVIDERS as l,
  applyProviderCapabilityManualOverrides as m,
  normalizePetScalePercent as n,
  orderClaudeModelsByPreference as o,
  persist as p,
  shouldUseGatewayFirstOnboarding as q,
  reconcileBuiltinModelPreset as r,
  selectSettingsSnapshot as s,
  shouldShowClaudeCodeOnboarding as t,
  useSettingsStore as u,
  getEditionRecommendedProviderPresets as v,
  localizeEditionUrl as w,
  extractModelsFromEnv as x,
  providerHasApiKey as y,
  canUseOrganizationSettings as z
};
