export type LLMProviderPreset = {
  id: string;
  displayName: string;
  kind: "claude" | "openaiCompatible" | "xaiResponses" | "videoSeedance";
  endpoint: string | null;
  defaultModelID: string;
  docsURL: string;
  note: string;
  // providerKind maps to llm_configs.provider_kind; "text" for chat models,
  // "video.seedance" for the Volces/Doubao Seedance video adapter, etc.
  // Defaults to "text" when unset so existing presets stay text-only.
  providerKind?: string;
  // extras is a JSON blob of provider-specific defaults persisted on the
  // config row. For Seedance: ratio / duration / generate_audio / watermark.
  extras?: string;
};

export const LLM_PROVIDER_PRESETS: LLMProviderPreset[] = [
  {
    id: "claude",
    displayName: "Claude (Anthropic)",
    kind: "claude",
    endpoint: null,
    defaultModelID: "claude-sonnet-4-5",
    docsURL: "https://console.anthropic.com/settings/keys",
    note: "Anthropic Claude - best for code / reasoning",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    kind: "openaiCompatible",
    endpoint: null,
    defaultModelID: "gpt-4o-mini",
    docsURL: "https://platform.openai.com/api-keys",
    note: "OpenAI GPT-4o series",
  },
  {
    id: "xai",
    displayName: "xAI (Grok)",
    kind: "xaiResponses",
    endpoint: "https://api.x.ai/v1/responses",
    defaultModelID: "grok-4-fast-reasoning",
    docsURL: "https://console.x.ai/",
    note: "xAI Grok - native Responses API with web_search enabled",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    kind: "openaiCompatible",
    endpoint: "https://api.deepseek.com/v1/chat/completions",
    defaultModelID: "deepseek-chat",
    docsURL: "https://platform.deepseek.com/api_keys",
    note: "DeepSeek - strong reasoning, low price",
  },
  {
    id: "doubao",
    displayName: "豆包 (Doubao)",
    kind: "openaiCompatible",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    defaultModelID: "doubao-seed-1-6-250615",
    docsURL: "https://console.volcengine.com/ark",
    note: "ByteDance Volces ARK - 豆包大模型",
  },
  {
    id: "qwen",
    displayName: "通义千问 (Qwen)",
    kind: "openaiCompatible",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    defaultModelID: "qwen-plus",
    docsURL: "https://dashscope.console.aliyun.com/",
    note: "Alibaba Cloud DashScope - 通义千问",
  },
  {
    id: "moonshot",
    displayName: "Kimi (Moonshot)",
    kind: "openaiCompatible",
    endpoint: "https://api.moonshot.cn/v1/chat/completions",
    defaultModelID: "moonshot-v1-32k",
    docsURL: "https://platform.moonshot.cn/console/api-keys",
    note: "Moonshot AI - 月之暗面 Kimi",
  },
  {
    id: "xiaomimimo",
    displayName: "小米 MiMo",
    kind: "openaiCompatible",
    endpoint: "https://api.xiaomimimo.com/v1/chat/completions",
    defaultModelID: "mimo-7b",
    docsURL: "https://mimo.xiaomi.com/",
    note: "Xiaomi MiMo",
  },
  {
    // Video preset. NOT a chat model — this config is consumed only by
    // the Video Studio module and is filtered out of the chat / bot
    // pickers by provider_kind on the backend.
    id: "seedance",
    displayName: "🎬 Seedance · 火山豆包视频",
    kind: "videoSeedance",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModelID: "doubao-seedance-1-0-pro-250528",
    docsURL: "https://console.volcengine.com/ark",
    note: "Video generation only. Use in Video Studio, not Chat. 仅用于 Video Studio，不参与 Chat。",
    providerKind: "video.seedance",
    extras: `{"ratio":"9:16","duration":10,"generate_audio":true,"watermark":false}`,
  },
];

export function getPresetByID(id: string): LLMProviderPreset | undefined {
  return LLM_PROVIDER_PRESETS.find((item) => item.id === id);
}

export function resolvePresetEndpoint(preset: LLMProviderPreset): string {
  if (preset.endpoint) {
    return preset.endpoint;
  }
  if (preset.id === "openai") {
    return "https://api.openai.com/v1/chat/completions";
  }
  if (preset.id === "claude") {
    return "https://api.anthropic.com/v1/messages";
  }
  return "";
}

export function resolvePresetProviderKind(preset: LLMProviderPreset): string {
  return preset.providerKind || "text";
}

export function resolvePresetExtras(preset: LLMProviderPreset): string {
  return preset.extras || "{}";
}

export function matchPresetByBaseURL(baseURL: string): string | null {
  const text = (baseURL || "").toLowerCase().trim();
  if (!text) {
    return null;
  }
  if (text.includes("api.anthropic.com")) return "claude";
  if (text.includes("api.openai.com")) return "openai";
  if (text.includes("api.x.ai")) return "xai";
  if (text.includes("api.deepseek.com")) return "deepseek";
  // Volces hosts both Doubao text chat (/chat/completions) and Seedance
  // video (/contents/generations/tasks, base ends at /api/v3). Match the
  // path tail before defaulting to text so Seedance edits don't get
  // rewritten as Doubao text on save.
  if (text.includes("volces.com")) {
    if (text.includes("/chat/completions")) return "doubao";
    return "seedance";
  }
  if (text.includes("dashscope.aliyuncs.com")) return "qwen";
  if (text.includes("api.moonshot.cn")) return "moonshot";
  if (text.includes("xiaomimimo.com")) return "xiaomimimo";
  return null;
}

// matchPresetForConfig prefers the config's persisted provider_kind over
// URL guessing. Authoritative when present — solves the case where two
// presets share a host (e.g. Doubao text chat vs Seedance video both on
// ark.cn-beijing.volces.com).
export function matchPresetForConfig(config: { base_url?: string; provider_kind?: string }): string | null {
  if (config.provider_kind === "video.seedance") return "seedance";
  return matchPresetByBaseURL(config.base_url || "");
}

