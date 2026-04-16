export const LLM_PROVIDER_PRESETS = [
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
];
export function getPresetByID(id) {
    return LLM_PROVIDER_PRESETS.find((item) => item.id === id);
}
export function resolvePresetEndpoint(preset) {
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
export function matchPresetByBaseURL(baseURL) {
    const text = (baseURL || "").toLowerCase().trim();
    if (!text) {
        return null;
    }
    if (text.includes("api.anthropic.com"))
        return "claude";
    if (text.includes("api.openai.com"))
        return "openai";
    if (text.includes("api.x.ai"))
        return "xai";
    if (text.includes("api.deepseek.com"))
        return "deepseek";
    if (text.includes("volces.com"))
        return "doubao";
    if (text.includes("dashscope.aliyuncs.com"))
        return "qwen";
    if (text.includes("api.moonshot.cn"))
        return "moonshot";
    if (text.includes("xiaomimimo.com"))
        return "xiaomimimo";
    return null;
}
