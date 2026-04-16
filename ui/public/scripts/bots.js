import { createBotUser, createLLMConfig, fetchAvailableLLMConfigs, fetchBotUsers, fetchLLMConfigs, removeBotUser, removeLLMConfig, testLLMConfig, updateBotUser, updateLLMConfig, } from "./api/dashboard.js";
import { logout, fetchCurrentUser } from "./api/session.js";
import { byId } from "./lib/dom.js";
import { LLM_PROVIDER_PRESETS, getPresetByID, matchPresetByBaseURL, resolvePresetEndpoint } from "./lib/llm_presets.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { t } from "./lib/i18n.js";
import { renderMarkdown } from "./lib/marked.js";
// ── LLM Config DOM ──────────────────────────────────────────────────────────
const llmConfigForm = byId("llmConfigForm");
const llmProviderPresetSelect = byId("llmProviderPresetSelect");
const llmProviderPresetNote = byId("llmProviderPresetNote");
const llmProviderPresetDocs = byId("llmProviderPresetDocs");
const llmConfigNameInput = byId("llmConfigNameInput");
const llmConfigBaseUrlInput = byId("llmConfigBaseUrlInput");
const llmConfigModelInput = byId("llmConfigModelInput");
const llmConfigApiKeyInput = byId("llmConfigApiKeyInput");
const llmConfigSystemPromptInput = byId("llmConfigSystemPromptInput");
const llmConfigSharedInput = byId("llmConfigSharedInput");
const llmConfigResetBtn = byId("llmConfigResetBtn");
const llmConfigTestBtn = byId("llmConfigTestBtn");
const llmConfigSubmitBtn = byId("llmConfigSubmitBtn");
const llmConfigStatus = byId("llmConfigStatus");
const llmConfigList = byId("llmConfigList");
// ── Bot User DOM ─────────────────────────────────────────────────────────────
const botUserForm = byId("botUserForm");
const botUserNameInput = byId("botUserNameInput");
const botUserConfigSelect = byId("botUserConfigSelect");
const botUserDescriptionInput = byId("botUserDescriptionInput");
const botUserSystemPromptInput = byId("botUserSystemPromptInput");
const botUserResetBtn = byId("botUserResetBtn");
const botUserSubmitBtn = byId("botUserSubmitBtn");
const botUserStatus = byId("botUserStatus");
const botUserList = byId("botUserList");
const welcomeText = byId("welcomeText");
const logoutBtn = byId("logoutBtn");
// ── State ─────────────────────────────────────────────────────────────────────
let editingLLMConfigId = null;
let editingBotUserId = null;
let pendingDeleteLLMConfigId = null;
let pendingDeleteBotId = null;
let expandedBotId = null;
let currentLLMConfigs = [];
let currentAvailableLLMConfigs = [];
let currentBotUsers = [];
function populateLLMProviderPresets() {
    llmProviderPresetSelect.innerHTML = LLM_PROVIDER_PRESETS
        .map((item) => `<option value="${item.id}">${item.displayName}</option>`)
        .join("");
}
function applyLLMProviderPreset(presetID, keepName = false) {
    const preset = getPresetByID(presetID) || LLM_PROVIDER_PRESETS[0];
    llmProviderPresetSelect.value = preset.id;
    llmConfigBaseUrlInput.value = resolvePresetEndpoint(preset);
    llmConfigModelInput.value = preset.defaultModelID;
    llmProviderPresetNote.textContent = preset.note;
    llmProviderPresetDocs.href = preset.docsURL;
    if (!keepName || !llmConfigNameInput.value.trim()) {
        llmConfigNameInput.value = `${preset.displayName} Preset`;
    }
}
// ── LLM Config ────────────────────────────────────────────────────────────────
function resetLLMConfigForm() {
    editingLLMConfigId = null;
    llmConfigForm.reset();
    llmConfigApiKeyInput.value = "";
    llmConfigStatus.textContent = "";
    llmConfigSubmitBtn.textContent = t("dashboard.saveConfigBtn");
    applyLLMProviderPreset(LLM_PROVIDER_PRESETS[0].id, false);
}
function renderLLMConfigList(configs) {
    if (!configs.length) {
        llmConfigList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.noLLMConfigs")}</li>`;
        return;
    }
    llmConfigList.innerHTML = configs
        .map((config) => {
        const isPending = pendingDeleteLLMConfigId === config.id;
        const actions = isPending
            ? `<button class="btn-inline" type="button" data-action="confirm-delete">${t("common.confirmDelete")}</button>
           <button class="btn-inline btn-secondary" type="button" data-action="cancel-delete">${t("common.cancel")}</button>`
            : `<button class="btn-inline btn-secondary" type="button" data-action="edit">${t("common.edit")}</button>
           <button class="btn-inline" type="button" data-action="delete">${t("common.delete")}</button>`;
        return `
        <li class="tag-item${isPending ? " tag-item-pending-delete" : ""}" data-llm-config-id="${config.id}">
          <div class="tag-item-main">
            <div class="tag-item-header">
              <strong>${config.name}</strong>
              <span class="tag-chip">${config.model}</span>
              ${config.has_api_key ? `<span class="tag-chip">${t("dashboard.keySaved")}</span>` : `<span class="tag-chip">${t("dashboard.noKey")}</span>`}
              ${config.shared ? `<span class="tag-chip">${t("dashboard.shared")}</span>` : `<span class="tag-chip">${t("dashboard.private")}</span>`}
            </div>
            <div class="tag-item-meta">${config.base_url}</div>
            <div class="tag-item-desc">${config.system_prompt || t("dashboard.noSystemPrompt")}</div>
          </div>
          <div class="tag-item-actions">${actions}</div>
        </li>
      `;
    })
        .join("");
}
// ── Bot User ──────────────────────────────────────────────────────────────────
function resetBotUserForm() {
    editingBotUserId = null;
    botUserForm.reset();
    botUserStatus.textContent = "";
    botUserSubmitBtn.textContent = t("dashboard.saveBotBtn");
}
function syncBotConfigOptions(configs) {
    if (!configs.length) {
        botUserConfigSelect.innerHTML = `<option value="">${t("dashboard.createLLMConfigFirst")}</option>`;
        botUserConfigSelect.disabled = true;
        botUserSubmitBtn.disabled = true;
        return;
    }
    const currentValue = editingBotUserId ? botUserConfigSelect.value : "";
    botUserConfigSelect.innerHTML = configs
        .map((config) => `<option value="${config.id}">${config.name} · ${config.model}</option>`)
        .join("");
    if (currentValue && configs.some((config) => String(config.id) === currentValue)) {
        botUserConfigSelect.value = currentValue;
    }
    botUserConfigSelect.disabled = false;
    botUserSubmitBtn.disabled = false;
}
function renderBotUserList(bots) {
    if (!bots.length) {
        botUserList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.noBots")}</li>`;
        return;
    }
    botUserList.innerHTML = bots
        .map((bot) => {
        const isPending = pendingDeleteBotId === bot.id;
        const isExpanded = expandedBotId === bot.id;
        const actions = isPending
            ? `<button class="btn-inline" type="button" data-action="confirm-delete">${t("common.confirmDelete")}</button>
           <button class="btn-inline btn-secondary" type="button" data-action="cancel-delete">${t("common.cancel")}</button>`
            : `<button class="btn-inline btn-secondary" type="button" data-action="toggle-expand">${isExpanded ? "▲" : "▼"}</button>
           <button class="btn-inline btn-secondary" type="button" data-action="chat">${t("dashboard.chat")}</button>
           <button class="btn-inline btn-secondary" type="button" data-action="edit">${t("common.edit")}</button>
           <button class="btn-inline" type="button" data-action="delete">${t("common.delete")}</button>`;
        const descHtml = bot.description ? renderMarkdown(bot.description) : "";
        const promptHtml = bot.system_prompt ? renderMarkdown(bot.system_prompt) : "";
        const expandPanel = isExpanded ? `
        <div class="bot-expand-panel">
          ${descHtml ? `<div class="bot-expand-section"><div class="bot-expand-label">${t("dashboard.botDescriptionLabel")}</div><div class="content-box bot-expand-content">${descHtml}</div></div>` : ""}
          ${promptHtml ? `<div class="bot-expand-section"><div class="bot-expand-label">${t("dashboard.botSystemPromptLabel")}</div><div class="content-box bot-expand-content">${promptHtml}</div></div>` : ""}
        </div>` : "";
        return `
        <li class="tag-item${isPending ? " tag-item-pending-delete" : ""}${isExpanded ? " tag-item-expanded" : ""}" data-bot-user-id="${bot.id}">
          <div class="tag-item-main">
            <div class="tag-item-header">
              <strong>${bot.name}</strong>
              <span class="tag-chip">${bot.config_name}</span>
            </div>
            <div class="tag-item-meta">${t("dashboard.botUserId", { id: bot.bot_user_id })}</div>
          </div>
          <div class="tag-item-actions">${actions}</div>
          ${expandPanel}
        </li>
      `;
    })
        .join("");
}
async function loadData() {
    const [ownResult, availableResult, botResult] = await Promise.all([
        fetchLLMConfigs(),
        fetchAvailableLLMConfigs(),
        fetchBotUsers(),
    ]);
    if (ownResult.response.ok) {
        currentLLMConfigs = ownResult.data.configs || [];
        renderLLMConfigList(currentLLMConfigs);
    }
    else {
        llmConfigStatus.textContent = ownResult.data.error || t("dashboard.llmConfigLoadFailed");
        llmConfigList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.llmConfigLoadFailed")}</li>`;
    }
    if (availableResult.response.ok) {
        currentAvailableLLMConfigs = availableResult.data.configs || [];
    }
    else {
        currentAvailableLLMConfigs = [];
    }
    syncBotConfigOptions(currentAvailableLLMConfigs);
    if (botResult.response.ok) {
        currentBotUsers = botResult.data.bots || [];
        renderBotUserList(currentBotUsers);
    }
    else {
        botUserStatus.textContent = botResult.data.error || t("dashboard.botListLoadFailed");
        botUserList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.botListLoadFailed")}</li>`;
    }
}
async function bootstrap() {
    await hydrateSiteBrand();
    const { response, data } = await fetchCurrentUser();
    if (!response.ok) {
        window.location.replace("/login.html");
        return;
    }
    welcomeText.textContent = data.username || "";
    renderSidebarFoot(data);
    await loadData();
}
// ── Event handlers ────────────────────────────────────────────────────────────
llmConfigResetBtn.addEventListener("click", () => {
    resetLLMConfigForm();
});
llmProviderPresetSelect.addEventListener("change", () => {
    applyLLMProviderPreset(llmProviderPresetSelect.value, false);
});
llmConfigTestBtn.addEventListener("click", async () => {
    const payload = {
        name: llmConfigNameInput.value.trim(),
        base_url: llmConfigBaseUrlInput.value.trim(),
        model: llmConfigModelInput.value.trim(),
        api_key: llmConfigApiKeyInput.value.trim(),
        system_prompt: llmConfigSystemPromptInput.value.trim(),
        shared: llmConfigSharedInput.checked,
    };
    if (!payload.name || !payload.base_url || !payload.model) {
        llmConfigStatus.textContent = t("dashboard.llmConfigMissingFields");
        return;
    }
    llmConfigTestBtn.disabled = true;
    llmConfigSubmitBtn.disabled = true;
    llmConfigStatus.textContent = t("dashboard.llmConfigTesting");
    try {
        const { response, data } = await testLLMConfig(payload);
        llmConfigStatus.textContent = response.ok
            ? data.message || t("dashboard.llmTestSuccess")
            : data.error || t("dashboard.llmTestFailed");
    }
    catch {
        llmConfigStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        llmConfigTestBtn.disabled = false;
        llmConfigSubmitBtn.disabled = false;
    }
});
llmConfigForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        name: llmConfigNameInput.value.trim(),
        base_url: llmConfigBaseUrlInput.value.trim(),
        model: llmConfigModelInput.value.trim(),
        api_key: llmConfigApiKeyInput.value.trim(),
        system_prompt: llmConfigSystemPromptInput.value.trim(),
        shared: llmConfigSharedInput.checked,
    };
    if (!payload.name || !payload.base_url || !payload.model) {
        llmConfigStatus.textContent = t("dashboard.llmConfigMissingFields");
        return;
    }
    llmConfigSubmitBtn.disabled = true;
    llmConfigStatus.textContent = editingLLMConfigId ? t("dashboard.llmConfigSaving") : t("dashboard.llmConfigCreating");
    try {
        const { response, data } = editingLLMConfigId
            ? await updateLLMConfig(editingLLMConfigId, { ...payload, update_api_key: payload.api_key !== "" })
            : await createLLMConfig(payload);
        if (!response.ok) {
            llmConfigStatus.textContent = data.error || t("common.saveFailed");
            return;
        }
        llmConfigStatus.textContent = editingLLMConfigId ? t("dashboard.llmConfigUpdated") : t("dashboard.llmConfigCreated");
        resetLLMConfigForm();
        await loadData();
    }
    catch {
        llmConfigStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        llmConfigSubmitBtn.disabled = false;
    }
});
llmConfigList.addEventListener("click", async (event) => {
    const target = event.target;
    const button = target.closest("button[data-action]");
    if (!button)
        return;
    const item = button.closest("[data-llm-config-id]");
    const configID = Number(item?.dataset.llmConfigId || 0);
    const config = currentLLMConfigs.find((entry) => entry.id === configID);
    if (!config)
        return;
    const action = button.dataset.action;
    if (action === "edit") {
        editingLLMConfigId = config.id;
        const presetID = matchPresetByBaseURL(config.base_url) || LLM_PROVIDER_PRESETS[0].id;
        applyLLMProviderPreset(presetID, true);
        llmConfigNameInput.value = config.name;
        llmConfigBaseUrlInput.value = config.base_url;
        llmConfigModelInput.value = config.model;
        llmConfigApiKeyInput.value = "";
        llmConfigSystemPromptInput.value = config.system_prompt || "";
        llmConfigSharedInput.checked = config.shared;
        llmConfigSubmitBtn.textContent = t("dashboard.updateConfig");
        llmConfigStatus.textContent = config.has_api_key ? t("dashboard.apiKeySaved") : "";
        llmConfigNameInput.focus();
        return;
    }
    if (action === "delete") {
        pendingDeleteLLMConfigId = config.id;
        renderLLMConfigList(currentLLMConfigs);
        return;
    }
    if (action === "cancel-delete") {
        pendingDeleteLLMConfigId = null;
        renderLLMConfigList(currentLLMConfigs);
        return;
    }
    if (action === "confirm-delete") {
        pendingDeleteLLMConfigId = null;
        const { response, data } = await removeLLMConfig(config.id);
        if (!response.ok) {
            llmConfigStatus.textContent = data.error || t("common.deleteFailed");
            renderLLMConfigList(currentLLMConfigs);
            return;
        }
        llmConfigStatus.textContent = t("dashboard.configDeleted", { name: config.name });
        resetLLMConfigForm();
        await loadData();
    }
});
botUserResetBtn.addEventListener("click", () => {
    resetBotUserForm();
});
botUserForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
        name: botUserNameInput.value.trim(),
        description: botUserDescriptionInput.value.trim(),
        system_prompt: botUserSystemPromptInput.value.trim(),
        llm_config_id: Number(botUserConfigSelect.value || 0),
    };
    if (!payload.name || payload.llm_config_id <= 0) {
        botUserStatus.textContent = t("dashboard.botMissingFields");
        return;
    }
    botUserSubmitBtn.disabled = true;
    botUserStatus.textContent = editingBotUserId ? t("dashboard.botSaving") : t("dashboard.botCreating");
    try {
        const { response, data } = editingBotUserId
            ? await updateBotUser(editingBotUserId, payload)
            : await createBotUser(payload);
        if (!response.ok) {
            botUserStatus.textContent = data.error || t("common.saveFailed");
            return;
        }
        botUserStatus.textContent = editingBotUserId ? t("dashboard.botUpdated") : t("dashboard.botCreated");
        resetBotUserForm();
        await loadData();
    }
    catch {
        botUserStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        botUserSubmitBtn.disabled = false;
    }
});
botUserList.addEventListener("click", async (event) => {
    const target = event.target;
    const button = target.closest("button[data-action]");
    if (!button)
        return;
    const item = button.closest("[data-bot-user-id]");
    const botID = Number(item?.dataset.botUserId || 0);
    const bot = currentBotUsers.find((entry) => entry.id === botID);
    if (!bot)
        return;
    const action = button.dataset.action;
    if (action === "toggle-expand") {
        expandedBotId = expandedBotId === bot.id ? null : bot.id;
        renderBotUserList(currentBotUsers);
        return;
    }
    if (action === "chat") {
        window.location.href = `/chat.html?user_id=${encodeURIComponent(bot.bot_user_id)}&username=${encodeURIComponent(bot.name)}`;
        return;
    }
    if (action === "edit") {
        editingBotUserId = bot.id;
        botUserNameInput.value = bot.name;
        botUserDescriptionInput.value = bot.description || "";
        botUserSystemPromptInput.value = bot.system_prompt || "";
        botUserConfigSelect.value = String(bot.llm_config_id);
        botUserSubmitBtn.textContent = t("dashboard.updateBot");
        botUserStatus.textContent = "";
        botUserNameInput.focus();
        return;
    }
    if (action === "delete") {
        pendingDeleteBotId = bot.id;
        renderBotUserList(currentBotUsers);
        return;
    }
    if (action === "cancel-delete") {
        pendingDeleteBotId = null;
        renderBotUserList(currentBotUsers);
        return;
    }
    if (action === "confirm-delete") {
        pendingDeleteBotId = null;
        const { response, data } = await removeBotUser(bot.id);
        if (!response.ok) {
            botUserStatus.textContent = data.error || t("common.deleteFailed");
            renderBotUserList(currentBotUsers);
            return;
        }
        botUserStatus.textContent = t("dashboard.botDeleted", { name: bot.name });
        resetBotUserForm();
        await loadData();
    }
});
logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
        const response = await logout();
        if (response.ok) {
            window.location.replace("/login.html");
        }
    }
    finally {
        logoutBtn.disabled = false;
    }
});
void bootstrap();
populateLLMProviderPresets();
llmConfigBaseUrlInput.readOnly = true;
llmConfigModelInput.readOnly = true;
applyLLMProviderPreset(LLM_PROVIDER_PRESETS[0].id, false);
