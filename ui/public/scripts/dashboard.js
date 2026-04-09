import { createBotUser, createLLMConfig, beginPasskeyRegistration, createTag, deleteApplePushCertificate, deleteEntry, fetchAvailableLLMConfigs, fetchBotUsers, fetchEntries, fetchEntry, fetchLLMConfigs, fetchLoginHistory, fetchPasskeys, fetchSiteSettings, fetchTags, finishPasskeyRegistration, removePasskey, removeBotUser, removeLLMConfig, removeTag, testLLMConfig, updateBotUser, updateLLMConfig, updateSiteSettings, updateTag, uploadApplePushCertificate, uploadSiteIcon, uploadUserIcon, fetchLatchProxies, createLatchProxy, updateLatchProxy, removeLatchProxy, fetchLatchProxyVersions, rollbackLatchProxy, fetchLatchRules, createLatchRule, createLatchRuleFromFile, updateLatchRule, uploadLatchRuleFile, removeLatchRule, fetchLatchRuleVersions, rollbackLatchRule, fetchLatchAdminProfiles, createLatchProfile, updateLatchProfile, removeLatchProfile, } from "./api/dashboard.js";
import { fetchCurrentUser, logout, sendEmailVerification } from "./api/session.js";
import { formatDeviceType } from "./lib/client.js";
import { makeDefaultAvatar } from "./lib/avatar.js";
import { byId, query } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { base64URLToBuffer, credentialToJSON } from "./lib/passkey.js";
import { hydrateSiteBrand, renderSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme, applyTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";
const welcomeText = byId("welcomeText");
const entryList = byId("entryList");
const entryContent = byId("entryContent");
const logoutBtn = byId("logoutBtn");
const newEntryBtn = byId("newEntryBtn");
const loadMoreBtn = byId("loadMoreBtn");
const editBtn = byId("editBtn");
const deleteBtn = byId("deleteBtn");
const drawerToggleBtn = byId("drawerToggleBtn");
const drawerCloseBtn = byId("drawerCloseBtn");
const drawerBackdrop = byId("drawerBackdrop");
const entryDrawer = byId("entryDrawer");
const loginHistoryList = byId("loginHistoryList");
const themeToggleBtn = byId("themeToggleBtn");
const passkeyRegisterBtn = byId("passkeyRegisterBtn");
const passkeyStatus = byId("passkeyStatus");
const passkeyList = byId("passkeyList");
const sendEmailVerificationBtn = byId("sendEmailVerificationBtn");
const emailVerificationAddress = byId("emailVerificationAddress");
const emailVerificationState = byId("emailVerificationState");
const emailVerificationStatus = byId("emailVerificationStatus");
const userIcon = byId("userIcon");
const iconFile = byId("iconFile");
const iconEditor = byId("iconEditor");
const iconCanvas = byId("iconCanvas");
const iconZoom = byId("iconZoom");
const saveIconBtn = byId("saveIconBtn");
const cancelIconBtn = byId("cancelIconBtn");
const iconStatus = byId("iconStatus");
const settingsCardAvatar = byId("settingsCardAvatar");
const settingsCardName = byId("settingsCardName");
const settingsCardMeta = byId("settingsCardMeta");
const dashboardRoleBadge = byId("dashboardRoleBadge");
const settingsCardRoleBadge = byId("settingsCardRoleBadge");
const settingsProfileName = byId("settingsProfileName");
const settingsProfileMeta = byId("settingsProfileMeta");
const settingsProfileRoleBadge = byId("settingsProfileRoleBadge");
const addTagBtn = byId("addTagBtn");
const tagModal = byId("tagModal");
const tagModalTitle = byId("tagModalTitle");
const tagModalCloseBtn = byId("tagModalCloseBtn");
const tagForm = byId("tagForm");
const tagName = byId("tagName");
const tagSlug = byId("tagSlug");
const tagDesc = byId("tagDesc");
const tagOrder = byId("tagOrder");
const tagFormStatus = byId("tagFormStatus");
const tagSubmitBtn = byId("tagSubmitBtn");
const openSiteAdminBtn = byId("openSiteAdminBtn");
const siteAdminModal = byId("siteAdminModal");
const siteAdminModalTitle = byId("siteAdminModalTitle");
const siteAdminModalCloseBtn = byId("siteAdminModalCloseBtn");
const settingsSectionLead = byId("settingsSectionLead");
const siteAdminPanel = byId("siteAdminPanel");
const themeCurrentValue = byId("themeCurrentValue");
const llmConfigForm = byId("llmConfigForm");
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
const settingsGitTagVersion = byId("settingsGitTagVersion");
const settingsOS = byId("settingsOS");
const settingsCPUArch = byId("settingsCPUArch");
const settingsPartitionCapacity = byId("settingsPartitionCapacity");
const settingsPartitionPath = byId("settingsPartitionPath");
const botUserForm = byId("botUserForm");
const botUserNameInput = byId("botUserNameInput");
const botUserConfigSelect = byId("botUserConfigSelect");
const botUserDescriptionInput = byId("botUserDescriptionInput");
const botUserSystemPromptInput = byId("botUserSystemPromptInput");
const botUserResetBtn = byId("botUserResetBtn");
const botUserSubmitBtn = byId("botUserSubmitBtn");
const botUserStatus = byId("botUserStatus");
const botUserList = byId("botUserList");
const siteNameInput = byId("siteNameInput");
const siteDescriptionInput = byId("siteDescriptionInput");
const saveSiteBtn = byId("saveSiteBtn");
const siteStatus = byId("siteStatus");
const siteIconPreview = byId("siteIconPreview");
const siteIconFile = byId("siteIconFile");
const applePushDevFile = byId("applePushDevFile");
const applePushProdFile = byId("applePushProdFile");
const applePushDevMeta = byId("applePushDevMeta");
const applePushProdMeta = byId("applePushProdMeta");
const applePushDevDeleteBtn = byId("applePushDevDeleteBtn");
const applePushProdDeleteBtn = byId("applePushProdDeleteBtn");
const siteAddTagBtnProxy = byId("siteAddTagBtnProxy");
const tagList = byId("tagList");
// Latch — sub-tab
const latchSubtabBtns = document.querySelectorAll("[data-latch-tab]");
const latchTabPanels = document.querySelectorAll("[data-latch-panel]");
// Latch — proxies
const latchProxyFormTitle = byId("latchProxyFormTitle");
const latchProxyNameInput = byId("latchProxyNameInput");
const latchProxyTypeSelect = byId("latchProxyTypeSelect");
const latchProxyConfigInput = byId("latchProxyConfigInput");
const latchProxyResetBtn = byId("latchProxyResetBtn");
const latchProxySubmitBtn = byId("latchProxySubmitBtn");
const latchProxyStatus = byId("latchProxyStatus");
const latchProxyList = byId("latchProxyList");
// Latch — rules
const latchRuleFormTitle = byId("latchRuleFormTitle");
const latchRuleNameInput = byId("latchRuleNameInput");
const latchRuleSourceInlineBtn = byId("latchRuleSourceInlineBtn");
const latchRuleSourceFileBtn = byId("latchRuleSourceFileBtn");
const latchRuleInlineSection = byId("latchRuleInlineSection");
const latchRuleFileSection = byId("latchRuleFileSection");
const latchRuleContentInput = byId("latchRuleContentInput");
const latchRuleResetBtn = byId("latchRuleResetBtn");
const latchRuleSubmitBtn = byId("latchRuleSubmitBtn");
const latchRuleFileInput = byId("latchRuleFileInput");
const latchRuleUploadBtn = byId("latchRuleUploadBtn");
const latchRuleStatus = byId("latchRuleStatus");
const latchRuleList = byId("latchRuleList");
// Latch — profiles
const latchProfileFormTitle = byId("latchProfileFormTitle");
const latchProfileNameInput = byId("latchProfileNameInput");
const latchProfileDescInput = byId("latchProfileDescInput");
const latchProfileEnabledInput = byId("latchProfileEnabledInput");
const latchProfileShareableInput = byId("latchProfileShareableInput");
const latchProfileProxyCheckboxes = byId("latchProfileProxyCheckboxes");
const latchProfileRuleRadios = byId("latchProfileRuleRadios");
const latchProfileResetBtn = byId("latchProfileResetBtn");
const latchProfileSubmitBtn = byId("latchProfileSubmitBtn");
const latchProfileStatus = byId("latchProfileStatus");
const latchProfileList = byId("latchProfileList");
const settingsNavButtons = Array.from(document.querySelectorAll("[data-settings-nav]"));
const settingsPanels = Array.from(document.querySelectorAll("[data-settings-panel]"));
const settingsOpenButtons = Array.from(document.querySelectorAll("[data-open-settings-center], #openSiteAdminBtn"));
const iconCtx = iconCanvas.getContext("2d");
let nextOffset = 0;
let hasMore = true;
let activeEntryId = null;
let iconImage = null;
let baseScale = 1;
let zoomValue = 1;
let offsetX = 0;
let offsetY = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let isAdmin = false;
let editingTagId = null;
let currentTags = [];
let editingLLMConfigId = null;
let editingBotUserId = null;
let editingLatchProxyGroupId = null;
let editingLatchRuleGroupId = null;
let editingLatchProfileId = null;
let currentLLMConfigs = [];
let currentAvailableLLMConfigs = [];
let currentBotUsers = [];
let currentLatchProxies = [];
let currentLatchRules = [];
let currentLatchProfiles = [];
let activeSettingsSection = "personalization";
function renderEmailVerificationState(email, verified) {
    emailVerificationAddress.textContent = email || t("dashboard.emailUnavailable");
    emailVerificationState.textContent = verified ? t("dashboard.emailVerifiedState") : t("dashboard.emailUnverifiedState");
    sendEmailVerificationBtn.disabled = !email || Boolean(verified);
}
function setStatusMessage(element, message, tone = "default") {
    element.textContent = message;
    element.classList.remove("status-success", "status-error");
    if (tone === "success") {
        element.classList.add("status-success");
    }
    else if (tone === "error") {
        element.classList.add("status-error");
    }
}
function setModalOpen(modal, open) {
    modal.classList.toggle("open", open);
    modal.setAttribute("aria-hidden", open ? "false" : "true");
    if (modal === siteAdminModal || modal === tagModal) {
        document.body.classList.toggle("modal-open", open);
    }
}
function isMobileLayout() {
    return window.innerWidth <= 860;
}
function setDrawerOpen(open) {
    if (!isMobileLayout()) {
        entryDrawer.classList.remove("open");
        drawerBackdrop.classList.remove("open");
        return;
    }
    entryDrawer.classList.toggle("open", open);
    drawerBackdrop.classList.toggle("open", open);
}
function setActiveEntryItem() {
    entryList.querySelectorAll("li[data-entry-id]").forEach((item) => {
        item.classList.toggle("active", Number(item.dataset.entryId) === activeEntryId);
    });
}
function syncThemeButton(theme) {
    themeToggleBtn.textContent = theme === "mono" ? t("dashboard.switchToDefault") : t("dashboard.switchToMonochrome");
    themeCurrentValue.textContent = theme === "mono" ? t("dashboard.themeMonochrome") : t("dashboard.themeDefault");
}
function switchSettingsSection(section) {
    activeSettingsSection = section;
    const titles = {
        profile: {
            title: t("dashboard.personalCenter"),
            lead: t("dashboard.profileLead"),
        },
        personalization: {
            title: t("dashboard.personalizationTitle"),
            lead: t("dashboard.personalizationLead"),
        },
        settings: {
            title: t("dashboard.settingsTitle"),
            lead: "",
        },
        system: {
            title: "系统信息",
            lead: "查看当前实例的版本、系统环境与程序所在分区的剩余容量。",
        },
        bots: {
            title: t("dashboard.botsManagementTitle"),
            lead: t("dashboard.botsLead"),
        },
        site: {
            title: t("dashboard.siteManagementTitle"),
            lead: t("dashboard.siteLead"),
        },
        latch: {
            title: "Latch 服务",
            lead: "管理员在这里维护全局代理配置与 rules 文件，客户端只消费当前 active 配置。",
        },
    };
    settingsPanels.forEach((panel) => {
        const matched = panel.dataset.settingsPanel === section;
        panel.hidden = !matched;
        panel.classList.toggle("active", matched);
    });
    settingsNavButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.settingsNav === section);
    });
    siteAdminModalTitle.textContent = titles[section].title;
    settingsSectionLead.textContent = titles[section].lead;
}
function formatLocation(record) {
    const parts = [record.city, record.region, record.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : t("dashboard.unknownLocation");
}
function formatLoginMethod(method) {
    if (method === "passkey") {
        return "Passkey";
    }
    if (method === "register") {
        return t("dashboard.loginMethodRegister");
    }
    return t("dashboard.loginMethodPassword");
}
function formatPasskeyLabel(credentialId) {
    if (!credentialId) {
        return "Passkey";
    }
    if (credentialId.length <= 12) {
        return credentialId;
    }
    return `${credentialId.slice(0, 6)}...${credentialId.slice(-6)}`;
}
function renderPasskeys(credentials = []) {
    const count = credentials.length;
    if (!count) {
        setStatusMessage(passkeyStatus, "未绑定 Passkey。");
        passkeyRegisterBtn.textContent = "绑定 Passkey";
        passkeyList.innerHTML = "<li>还没有绑定任何 Passkey</li>";
        return;
    }
    setStatusMessage(passkeyStatus, `已绑定 ${count} 个 Passkey。`, "success");
    passkeyRegisterBtn.textContent = "继续绑定";
    passkeyList.innerHTML = credentials
        .map((item) => {
        const createdAt = new Date(item.created_at).toLocaleString();
        const updatedAt = new Date(item.updated_at).toLocaleString();
        return `
        <li>
          <div class="meta-title">已绑定 · ${formatPasskeyLabel(item.credential_id)}</div>
          <div class="meta-subtitle">创建时间：${createdAt}</div>
          <div class="meta-subtitle">最近更新时间：${updatedAt}</div>
          <div class="meta-time">
            <button class="btn-inline btn-secondary" type="button" data-passkey-delete="${item.credential_id}">删除</button>
          </div>
        </li>
      `;
    })
        .join("");
    passkeyList.querySelectorAll("[data-passkey-delete]").forEach((button) => {
        button.addEventListener("click", async () => {
            const credentialId = button.dataset.passkeyDelete || "";
            if (!credentialId) {
                return;
            }
            if (!window.confirm("确认删除这个 Passkey 吗？删除后将不能再用它快速登录。")) {
                return;
            }
            button.disabled = true;
            setStatusMessage(passkeyStatus, "正在删除 Passkey...");
            try {
                const { response, data } = await removePasskey(credentialId);
                if (!response.ok) {
                    setStatusMessage(passkeyStatus, data.error || "删除失败", "error");
                    button.disabled = false;
                    return;
                }
                renderPasskeys(data.credentials || []);
                setStatusMessage(passkeyStatus, data.message || "Passkey 已删除", "success");
            }
            catch {
                setStatusMessage(passkeyStatus, "网络错误，请重试", "error");
                button.disabled = false;
            }
        });
    });
}
function defaultSiteIcon(name) {
    return makeDefaultAvatar(name || "站", 160);
}
function formatCertificateMeta(cert) {
    if (!cert?.file_name) {
        return t("dashboard.notUploaded");
    }
    const uploadedAt = cert.uploaded_at ? new Date(cert.uploaded_at).toLocaleString() : t("dashboard.unknownTime");
    return t("dashboard.certMeta", { filename: cert.file_name, time: uploadedAt });
}
function renderSystemInfo(systemInfo) {
    settingsGitTagVersion.textContent = systemInfo?.git_tag_version || "未知";
    settingsOS.textContent = systemInfo?.os || "未知";
    settingsCPUArch.textContent = systemInfo?.cpu_arch || "未知";
    settingsPartitionCapacity.textContent = systemInfo?.partition_capacity || "未知";
    settingsPartitionPath.textContent = systemInfo?.partition_path
        ? `路径：${systemInfo.partition_path}`
        : "";
}
function renderSiteSettings(site) {
    const safeSite = site || { name: "Polar-", description: "", icon_url: "" };
    siteNameInput.value = safeSite.name || "Polar-";
    siteDescriptionInput.value = safeSite.description || "";
    siteIconPreview.src = safeSite.icon_url || defaultSiteIcon(safeSite.name || "Polar-");
    applePushDevMeta.textContent = formatCertificateMeta(safeSite.apple_push_dev_cert);
    applePushProdMeta.textContent = formatCertificateMeta(safeSite.apple_push_prod_cert);
    applePushDevDeleteBtn.disabled = !safeSite.apple_push_dev_cert?.file_url;
    applePushProdDeleteBtn.disabled = !safeSite.apple_push_prod_cert?.file_url;
    renderSystemInfo(safeSite.system_info);
    renderSiteBrand(safeSite);
}
function renderTagList(tags) {
    if (!tags.length) {
        tagList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.noTags")}</li>`;
        return;
    }
    tagList.innerHTML = tags
        .map((tag) => `
        <li class="tag-item" data-tag-id="${tag.id}">
          <div class="tag-item-main">
            <div class="tag-item-header">
              <strong>${tag.name}</strong>
              <span class="tag-chip">${tag.slug}</span>
            </div>
            <div class="tag-item-meta">${t("dashboard.tagOrder", { order: String(tag.sort_order) })}</div>
            <div class="tag-item-desc">${tag.description || t("dashboard.noDescription")}</div>
          </div>
          <div class="tag-item-actions">
            <button class="btn-inline btn-secondary" type="button" data-action="edit">${t("common.edit")}</button>
            <button class="btn-inline" type="button" data-action="delete">${t("common.delete")}</button>
          </div>
        </li>
      `)
        .join("");
}
function resetLLMConfigForm() {
    editingLLMConfigId = null;
    llmConfigForm.reset();
    llmConfigApiKeyInput.value = "";
    llmConfigStatus.textContent = "";
    llmConfigSubmitBtn.textContent = t("dashboard.saveConfigBtn");
}
function resetBotUserForm() {
    editingBotUserId = null;
    botUserForm.reset();
    botUserStatus.textContent = "";
    botUserSubmitBtn.textContent = t("dashboard.saveBotBtn");
}
function renderLLMConfigList(configs) {
    if (!configs.length) {
        llmConfigList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.noLLMConfigs")}</li>`;
        return;
    }
    llmConfigList.innerHTML = configs
        .map((config) => `
        <li class="tag-item" data-llm-config-id="${config.id}">
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
          <div class="tag-item-actions">
            <button class="btn-inline btn-secondary" type="button" data-action="edit">${t("common.edit")}</button>
            <button class="btn-inline" type="button" data-action="delete">${t("common.delete")}</button>
          </div>
        </li>
      `)
        .join("");
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
        .map((bot) => `
        <li class="tag-item" data-bot-user-id="${bot.id}">
          <div class="tag-item-main">
            <div class="tag-item-header">
              <strong>${bot.name}</strong>
              <span class="tag-chip">${bot.config_name}</span>
            </div>
            <div class="tag-item-meta">${t("dashboard.botUserId", { id: bot.bot_user_id })}</div>
            <div class="tag-item-desc">${bot.description || t("dashboard.noDescription")}</div>
            <div class="tag-item-meta">${bot.system_prompt ? t("dashboard.botPromptPreview", { preview: bot.system_prompt.slice(0, 36) + (bot.system_prompt.length > 36 ? "" : "") }) : t("dashboard.noBotPrompt")}</div>
          </div>
          <div class="tag-item-actions">
            <button class="btn-inline btn-secondary" type="button" data-action="chat">${t("dashboard.chat")}</button>
            <button class="btn-inline btn-secondary" type="button" data-action="edit">${t("common.edit")}</button>
            <button class="btn-inline" type="button" data-action="delete">${t("common.delete")}</button>
          </div>
        </li>
      `)
        .join("");
}
// ---------------------------------------------------------------------------
// Latch helpers
// ---------------------------------------------------------------------------
function switchLatchTab(tab) {
    latchSubtabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.latchTab === tab));
    latchTabPanels.forEach((panel) => { panel.hidden = panel.dataset.latchPanel !== tab; });
}
// — Proxy —
function resetLatchProxyForm() {
    editingLatchProxyGroupId = null;
    latchProxyNameInput.value = "";
    latchProxyTypeSelect.value = "ss";
    latchProxyConfigInput.value = "";
    latchProxyFormTitle.textContent = "添加代理";
    latchProxySubmitBtn.textContent = "保存代理";
    setStatusMessage(latchProxyStatus, "");
}
function renderLatchProxies(proxies) {
    if (!proxies.length) {
        latchProxyList.innerHTML = '<li class="tag-item tag-item-empty">暂无代理。</li>';
        return;
    }
    latchProxyList.innerHTML = proxies.map((p) => `
    <li class="tag-item" data-latch-proxy-gid="${p.group_id}">
      <div class="tag-item-main">
        <div class="tag-item-header">
          <strong>${p.name}</strong>
          <span class="latch-proxy-chip">${p.type}</span>
          <span class="latch-version-badge">v${p.version}</span>
        </div>
        <div class="tag-item-meta latch-sha-text">SHA1 ${p.sha1.slice(0, 12)}…</div>
        <div class="tag-item-desc">${new Date(p.created_at).toLocaleString()}</div>
      </div>
      <div class="tag-item-actions">
        <button class="btn-inline btn-secondary" type="button" data-action="versions">版本</button>
        <button class="btn-inline btn-secondary" type="button" data-action="edit">编辑</button>
        <button class="btn-inline" type="button" data-action="delete">删除</button>
      </div>
    </li>`).join("");
}
function fillLatchProxyForm(proxy) {
    editingLatchProxyGroupId = proxy.group_id;
    latchProxyNameInput.value = proxy.name;
    latchProxyTypeSelect.value = proxy.type;
    latchProxyConfigInput.value = JSON.stringify(proxy.config ?? {}, null, 2);
    latchProxyFormTitle.textContent = "编辑代理";
    latchProxySubmitBtn.textContent = "更新代理";
    setStatusMessage(latchProxyStatus, "");
}
// — Rule —
function resetLatchRuleForm() {
    editingLatchRuleGroupId = null;
    latchRuleNameInput.value = "";
    latchRuleContentInput.value = "";
    latchRuleFileInput.value = "";
    latchRuleFormTitle.textContent = "添加规则";
    latchRuleSubmitBtn.textContent = "保存规则";
    setStatusMessage(latchRuleStatus, "");
}
function renderLatchRules(rules) {
    if (!rules.length) {
        latchRuleList.innerHTML = '<li class="tag-item tag-item-empty">暂无规则。</li>';
        return;
    }
    latchRuleList.innerHTML = rules.map((r) => `
    <li class="tag-item" data-latch-rule-gid="${r.group_id}">
      <div class="tag-item-main">
        <div class="tag-item-header">
          <strong>${r.name}</strong>
          <span class="latch-version-badge">v${r.version}</span>
        </div>
        <div class="tag-item-meta latch-sha-text">SHA1 ${r.sha1.slice(0, 12)}…</div>
        <div class="tag-item-desc">${r.content.split("\n").length} 行 · ${new Date(r.created_at).toLocaleString()}</div>
      </div>
      <div class="tag-item-actions">
        <button class="btn-inline btn-secondary" type="button" data-action="versions">版本</button>
        <button class="btn-inline btn-secondary" type="button" data-action="edit">编辑</button>
        <button class="btn-inline" type="button" data-action="delete">删除</button>
      </div>
    </li>`).join("");
}
function fillLatchRuleForm(rule) {
    editingLatchRuleGroupId = rule.group_id;
    latchRuleNameInput.value = rule.name;
    latchRuleContentInput.value = rule.content;
    latchRuleFormTitle.textContent = "编辑规则";
    latchRuleSubmitBtn.textContent = "更新规则";
    // Switch to inline mode when editing
    latchRuleInlineSection.hidden = false;
    latchRuleFileSection.hidden = true;
    latchRuleSourceInlineBtn.classList.add("active");
    latchRuleSourceFileBtn.classList.remove("active");
    setStatusMessage(latchRuleStatus, "");
}
// — Profile —
function resetLatchProfileForm() {
    editingLatchProfileId = null;
    latchProfileNameInput.value = "";
    latchProfileDescInput.value = "";
    latchProfileEnabledInput.checked = true;
    latchProfileShareableInput.checked = false;
    latchProfileFormTitle.textContent = "添加配置";
    latchProfileSubmitBtn.textContent = "保存配置";
    setStatusMessage(latchProfileStatus, "");
    // Uncheck all proxy checkboxes and rule radios
    latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    const noRule = latchProfileRuleRadios.querySelector("input[value='']");
    if (noRule)
        noRule.checked = true;
}
function syncLatchProfileSelectors(proxies, rules) {
    latchProfileProxyCheckboxes.innerHTML = proxies.length
        ? proxies.map((p) => `
        <label class="form-checkbox">
          <input type="checkbox" value="${p.group_id}" />
          <span>${p.name} <span class="latch-proxy-chip">${p.type}</span></span>
        </label>`).join("")
        : '<span style="color:var(--muted);font-size:13px">暂无代理</span>';
    latchProfileRuleRadios.innerHTML = `
    <label class="form-checkbox">
      <input type="radio" name="latch_rule" value="" checked />
      <span style="color:var(--muted)">不使用规则</span>
    </label>` + rules.map((r) => `
    <label class="form-checkbox">
      <input type="radio" name="latch_rule" value="${r.group_id}" />
      <span>${r.name} <span class="latch-version-badge">v${r.version}</span></span>
    </label>`).join("");
}
function renderLatchProfiles(profiles, proxies, rules) {
    if (!profiles.length) {
        latchProfileList.innerHTML = '<li class="tag-item tag-item-empty">暂无配置。</li>';
        return;
    }
    const proxyMap = new Map(proxies.map((p) => [p.group_id, p]));
    const ruleMap = new Map(rules.map((r) => [r.group_id, r]));
    latchProfileList.innerHTML = profiles.map((prof) => {
        const proxyChips = prof.proxy_group_ids
            .map((gid) => proxyMap.get(gid))
            .filter(Boolean)
            .map((p) => `<span class="latch-proxy-chip">${p.name}</span>`)
            .join("") || '<span style="color:var(--muted);font-size:12px">无代理</span>';
        const ruleLabel = prof.rule_group_id && ruleMap.get(prof.rule_group_id)
            ? `<span class="latch-version-badge">${ruleMap.get(prof.rule_group_id).name}</span>`
            : '<span style="color:var(--muted);font-size:12px">无规则</span>';
        return `
      <li class="tag-item" data-latch-profile-id="${prof.id}">
        <div class="tag-item-main">
          <div class="tag-item-header">
            <strong>${prof.name}</strong>
            ${prof.enabled ? '<span class="latch-flag on">enabled</span>' : '<span class="latch-flag">disabled</span>'}
            ${prof.shareable ? '<span class="latch-flag on">shareable</span>' : '<span class="latch-flag">private</span>'}
          </div>
          ${prof.description ? `<div class="tag-item-meta">${prof.description}</div>` : ""}
          <div class="latch-item-flags">${proxyChips}</div>
          <div class="tag-item-desc">规则：${ruleLabel}</div>
        </div>
        <div class="tag-item-actions">
          <button class="btn-inline btn-secondary" type="button" data-action="edit">编辑</button>
          <button class="btn-inline" type="button" data-action="delete">删除</button>
        </div>
      </li>`;
    }).join("");
}
function fillLatchProfileForm(prof) {
    editingLatchProfileId = prof.id;
    latchProfileNameInput.value = prof.name;
    latchProfileDescInput.value = prof.description || "";
    latchProfileEnabledInput.checked = prof.enabled;
    latchProfileShareableInput.checked = prof.shareable;
    // Check matching proxies
    latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = prof.proxy_group_ids.includes(cb.value);
    });
    // Select matching rule
    const radios = latchProfileRuleRadios.querySelectorAll("input[type=radio]");
    radios.forEach((r) => { r.checked = r.value === (prof.rule_group_id || ""); });
    latchProfileFormTitle.textContent = "编辑配置";
    latchProfileSubmitBtn.textContent = "更新配置";
    setStatusMessage(latchProfileStatus, "");
}
async function loadLoginHistory() {
    const { response, data } = await fetchLoginHistory();
    if (!response.ok) {
        loginHistoryList.innerHTML = `<li>${t("dashboard.loginHistoryLoadFailed")}</li>`;
        return;
    }
    const records = data.records || [];
    if (!records.length) {
        loginHistoryList.innerHTML = `<li>${t("dashboard.noLoginHistory")}</li>`;
        return;
    }
    loginHistoryList.innerHTML = records
        .map((record) => {
        const time = new Date(record.logged_in_at).toLocaleString();
        return `
        <li>
          <div class="meta-title">${record.ip_address || t("dashboard.unknownIp")} · ${formatLoginMethod(record.login_method)} · ${formatDeviceType(record.device_type, t)}</div>
          <div class="meta-subtitle">${formatLocation(record)}</div>
          <div class="meta-time">${time}</div>
        </li>
      `;
    })
        .join("");
}
async function loadPasskeys() {
    const { response, data } = await fetchPasskeys();
    if (!response.ok) {
        setStatusMessage(passkeyStatus, data.error || "无法加载 Passkey 状态", "error");
        passkeyList.innerHTML = "<li>无法加载 Passkey 列表</li>";
        return;
    }
    renderPasskeys(data.credentials || []);
}
async function loadProfile() {
    const { response, data } = await fetchCurrentUser();
    if (!response.ok) {
        window.location.href = "/login.html";
        return;
    }
    isAdmin = data.role === "admin";
    welcomeText.textContent = t("dashboard.welcome", { username: data.username });
    dashboardRoleBadge.hidden = !isAdmin;
    settingsCardName.textContent = data.username || t("dashboard.currentUser");
    settingsCardMeta.textContent = isAdmin ? t("dashboard.adminMeta") : t("dashboard.userMeta");
    settingsCardRoleBadge.hidden = !isAdmin;
    settingsProfileName.textContent = data.username || t("dashboard.currentUser");
    settingsProfileMeta.textContent = isAdmin ? t("dashboard.adminProfileMeta") : t("dashboard.userProfileMeta");
    settingsProfileRoleBadge.hidden = !isAdmin;
    renderEmailVerificationState(data.email, data.email_verified);
    setStatusMessage(emailVerificationStatus, "");
    addTagBtn.disabled = !isAdmin;
    addTagBtn.textContent = isAdmin ? t("dashboard.newTag") : t("dashboard.adminOnlyTag");
    addTagBtn.hidden = !isAdmin;
    siteAdminPanel.hidden = !isAdmin;
    settingsNavButtons.forEach((button) => {
        if (button.dataset.settingsNav === "site" || button.dataset.settingsNav === "latch") {
            button.hidden = !isAdmin;
        }
    });
    const avatar = data.icon_url || makeDefaultAvatar(data.username || "U", 160);
    if (data.icon_url) {
        userIcon.src = data.icon_url;
    }
    userIcon.src = avatar;
    settingsCardAvatar.src = avatar;
}
async function loadSiteAdminData() {
    const tasks = [
        (async () => {
            const { response, data } = await fetchSiteSettings();
            if (response.ok) {
                renderSiteSettings(data.site);
                return;
            }
            renderSystemInfo();
            if (isAdmin) {
                siteStatus.textContent = data.error || "无法加载站点信息";
            }
        })(),
        (async () => {
            const [ownResult, availableResult] = await Promise.all([fetchLLMConfigs(), fetchAvailableLLMConfigs()]);
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
                syncBotConfigOptions(currentAvailableLLMConfigs);
            }
            else {
                currentAvailableLLMConfigs = [];
                botUserStatus.textContent = availableResult.data.error || t("dashboard.availableConfigLoadFailed");
                syncBotConfigOptions(currentAvailableLLMConfigs);
            }
        })(),
        (async () => {
            const { response, data } = await fetchBotUsers();
            if (response.ok) {
                currentBotUsers = data.bots || [];
                renderBotUserList(currentBotUsers);
            }
            else {
                botUserStatus.textContent = data.error || t("dashboard.botListLoadFailed");
                botUserList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.botListLoadFailed")}</li>`;
            }
        })(),
    ];
    if (isAdmin) {
        tasks.push((async () => {
            const [siteResult, tagResult, proxyResult, ruleResult, profileResult] = await Promise.all([
                fetchSiteSettings(),
                fetchTags(),
                fetchLatchProxies(),
                fetchLatchRules(),
                fetchLatchAdminProfiles(),
            ]);
            if (siteResult.response.ok) {
                renderSiteSettings(siteResult.data.site);
            }
            else {
                siteStatus.textContent = siteResult.data.error || t("dashboard.siteInfoLoadFailed");
            }
            if (tagResult.response.ok) {
                currentTags = tagResult.data.tags || [];
                renderTagList(currentTags);
            }
            else {
                tagList.innerHTML = `<li class="tag-item tag-item-empty">${t("dashboard.tagListLoadFailed")}</li>`;
            }
            currentLatchProxies = proxyResult.response.ok ? (proxyResult.data.proxies || []) : [];
            currentLatchRules = ruleResult.response.ok ? (ruleResult.data.rules || []) : [];
            currentLatchProfiles = profileResult.response.ok ? (profileResult.data.profiles || []) : [];
            renderLatchProxies(currentLatchProxies);
            renderLatchRules(currentLatchRules);
            renderLatchProfiles(currentLatchProfiles, currentLatchProxies, currentLatchRules);
            syncLatchProfileSelectors(currentLatchProxies, currentLatchRules);
        })());
    }
    await Promise.all(tasks);
}
async function handleEmailVerificationSend() {
    sendEmailVerificationBtn.disabled = true;
    setStatusMessage(emailVerificationStatus, t("dashboard.sendingVerificationEmail"));
    try {
        const { response, data } = await sendEmailVerification();
        if (!response.ok) {
            renderEmailVerificationState(emailVerificationAddress.textContent || "", false);
            setStatusMessage(emailVerificationStatus, data.error || t("dashboard.emailVerificationSendFailed"), "error");
            return;
        }
        const { response: meResponse, data: meData } = await fetchCurrentUser();
        if (meResponse.ok) {
            renderEmailVerificationState(meData.email, meData.email_verified);
        }
        setStatusMessage(emailVerificationStatus, data.message || t("dashboard.verificationEmailSent"), "success");
    }
    catch {
        renderEmailVerificationState(emailVerificationAddress.textContent || "", false);
        setStatusMessage(emailVerificationStatus, t("common.networkErrorRetry"), "error");
    }
}
function openTagModal(tag) {
    editingTagId = tag?.id || null;
    tagForm.reset();
    tagOrder.value = String(tag?.sort_order ?? 0);
    tagName.value = tag?.name || "";
    tagSlug.value = tag?.slug || "";
    tagDesc.value = tag?.description || "";
    tagFormStatus.textContent = "";
    tagModalTitle.textContent = editingTagId ? t("dashboard.editTag") : t("dashboard.addTag");
    tagSubmitBtn.textContent = editingTagId ? t("common.save") : t("common.create");
    setModalOpen(tagModal, true);
    tagName.focus();
}
function closeTagModal() {
    editingTagId = null;
    setModalOpen(tagModal, false);
}
function openSiteAdminModal(section = "personalization") {
    switchSettingsSection(section);
    setModalOpen(siteAdminModal, true);
    if (section === "settings") {
        llmConfigNameInput.focus();
        return;
    }
    if (section === "bots") {
        botUserNameInput.focus();
        return;
    }
    if (section === "site") {
        siteNameInput.focus();
        return;
    }
    if (section === "latch") {
        latchProxyNameInput.focus();
        return;
    }
    if (section === "system") {
        settingsSectionLead.focus?.();
        return;
    }
    if (section === "profile") {
        passkeyRegisterBtn.focus();
        return;
    }
    themeToggleBtn.focus();
}
function closeSiteAdminModal() {
    setModalOpen(siteAdminModal, false);
}
async function loadEntries(reset = false) {
    if (reset) {
        nextOffset = 0;
        hasMore = true;
        entryList.innerHTML = "";
    }
    if (!hasMore) {
        return;
    }
    const { response, data } = await fetchEntries(nextOffset);
    if (!response.ok) {
        entryList.innerHTML = `<li>${t("dashboard.entryLoadFailed")}</li>`;
        return;
    }
    const entries = data.entries || [];
    if (reset && !entries.length) {
        entryList.innerHTML = `<li>${t("dashboard.noEntries")}</li>`;
        hasMore = false;
        loadMoreBtn.style.display = "none";
        return;
    }
    entries.forEach((entry) => {
        const li = document.createElement("li");
        li.dataset.entryId = String(entry.id);
        li.innerHTML = entry.is_public
            ? `<span>${entry.title}</span><span class="tag-chip">Public</span>`
            : `<span>${entry.title}</span>`;
        li.addEventListener("click", () => {
            void loadEntry(entry.id);
        });
        entryList.appendChild(li);
    });
    hasMore = Boolean(data.has_more);
    nextOffset = Number(data.next_offset || 0);
    loadMoreBtn.style.display = hasMore ? "inline-flex" : "none";
}
async function loadEntry(id) {
    const { response, data } = await fetchEntry(id);
    if (!response.ok) {
        entryContent.textContent = t("dashboard.entryReadFailed");
        return;
    }
    activeEntryId = data.entry ? data.entry.id : null;
    setActiveEntryItem();
    const rawContent = data.content || t("dashboard.emptyContent");
    entryContent.innerHTML = renderMarkdown(rawContent);
    editBtn.disabled = data.can_edit === false;
    deleteBtn.disabled = data.can_edit === false;
    if (isMobileLayout()) {
        setDrawerOpen(false);
    }
}
function drawIconPreview() {
    if (!iconCtx || !iconImage) {
        return;
    }
    const scale = baseScale * zoomValue;
    const drawW = iconImage.width * scale;
    const drawH = iconImage.height * scale;
    const minX = iconCanvas.width - drawW;
    const minY = iconCanvas.height - drawH;
    offsetX = Math.min(0, Math.max(minX, offsetX));
    offsetY = Math.min(0, Math.max(minY, offsetY));
    iconCtx.clearRect(0, 0, iconCanvas.width, iconCanvas.height);
    iconCtx.drawImage(iconImage, (iconCanvas.width - drawW) / 2 + offsetX, (iconCanvas.height - drawH) / 2 + offsetY, drawW, drawH);
}
function startDrag(clientX, clientY) {
    dragging = true;
    dragStartX = clientX;
    dragStartY = clientY;
}
function moveDrag(clientX, clientY) {
    if (!dragging) {
        return;
    }
    offsetX += clientX - dragStartX;
    offsetY += clientY - dragStartY;
    dragStartX = clientX;
    dragStartY = clientY;
    drawIconPreview();
}
function stopDrag() {
    dragging = false;
}
addTagBtn.addEventListener("click", () => {
    if (addTagBtn.disabled) {
        return;
    }
    openTagModal();
});
settingsOpenButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const target = button.dataset.settingsTarget || "personalization";
        openSiteAdminModal(target);
    });
});
siteAdminModalCloseBtn.addEventListener("click", closeSiteAdminModal);
query(siteAdminModal, ".modal-backdrop").addEventListener("click", closeSiteAdminModal);
settingsNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const target = button.dataset.settingsNav;
        if (!target) {
            return;
        }
        switchSettingsSection(target);
    });
});
siteAddTagBtnProxy.addEventListener("click", () => {
    if (!isAdmin) {
        return;
    }
    openTagModal();
});
tagModalCloseBtn.addEventListener("click", closeTagModal);
query(tagModal, ".modal-backdrop").addEventListener("click", closeTagModal);
tagForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    tagFormStatus.textContent = editingTagId ? t("dashboard.tagSaving") : t("dashboard.tagCreating");
    tagSubmitBtn.disabled = true;
    const payload = {
        name: tagName.value.trim(),
        slug: tagSlug.value.trim(),
        description: tagDesc.value.trim(),
        sort_order: Number(tagOrder.value || 0),
    };
    try {
        const { response, data } = editingTagId
            ? await updateTag(editingTagId, payload)
            : await createTag(payload);
        if (!response.ok) {
            tagFormStatus.textContent = data.error || t("dashboard.tagSaveFailed");
            return;
        }
        tagFormStatus.textContent = editingTagId ? t("dashboard.tagSaved") : t("dashboard.tagCreated");
        await loadSiteAdminData();
        window.setTimeout(() => {
            closeTagModal();
        }, 400);
    }
    catch {
        tagFormStatus.textContent = t("dashboard.tagSaveFailedRetry");
    }
    finally {
        tagSubmitBtn.disabled = false;
    }
});
tagList.addEventListener("click", async (event) => {
    const target = event.target;
    const button = target.closest("button[data-action]");
    if (!button) {
        return;
    }
    const item = button.closest("[data-tag-id]");
    const tagId = Number(item?.dataset.tagId || 0);
    const tag = currentTags.find((entry) => entry.id === tagId);
    if (!tag) {
        return;
    }
    const action = button.dataset.action;
    if (action === "edit") {
        openTagModal(tag);
        return;
    }
    if (action === "delete") {
        if (!window.confirm(t("dashboard.confirmDeleteTag", { name: tag.name }))) {
            return;
        }
        const { response, data } = await removeTag(tag.id);
        if (!response.ok) {
            siteStatus.textContent = data.error || t("common.deleteFailed");
            return;
        }
        siteStatus.textContent = t("dashboard.tagDeleted", { name: tag.name });
        await loadSiteAdminData();
    }
});
llmConfigResetBtn.addEventListener("click", () => {
    resetLLMConfigForm();
});
// ---------------------------------------------------------------------------
// Latch event handlers
// ---------------------------------------------------------------------------
// Sub-tab switching
latchSubtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
        switchLatchTab(btn.dataset.latchTab || "proxies");
    });
});
// — Proxy —
latchProxyResetBtn.addEventListener("click", resetLatchProxyForm);
latchProxySubmitBtn.addEventListener("click", async () => {
    const name = latchProxyNameInput.value.trim();
    const type = latchProxyTypeSelect.value;
    const raw = latchProxyConfigInput.value.trim();
    if (!name) {
        setStatusMessage(latchProxyStatus, "请填写代理名称", "error");
        return;
    }
    let config = {};
    if (raw) {
        try {
            config = JSON.parse(raw);
        }
        catch {
            setStatusMessage(latchProxyStatus, "配置 JSON 格式有误", "error");
            return;
        }
    }
    latchProxySubmitBtn.disabled = true;
    setStatusMessage(latchProxyStatus, editingLatchProxyGroupId ? "正在更新…" : "正在创建…");
    try {
        const { response, data } = editingLatchProxyGroupId
            ? await updateLatchProxy(editingLatchProxyGroupId, { name, type, config })
            : await createLatchProxy({ name, type, config });
        if (!response.ok) {
            setStatusMessage(latchProxyStatus, data.error || "保存失败", "error");
            return;
        }
        setStatusMessage(latchProxyStatus, data.message || (editingLatchProxyGroupId ? "代理已更新" : "代理已创建"), "success");
        resetLatchProxyForm();
        await loadSiteAdminData();
    }
    catch {
        setStatusMessage(latchProxyStatus, t("common.networkErrorRetry"), "error");
    }
    finally {
        latchProxySubmitBtn.disabled = false;
    }
});
latchProxyList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn)
        return;
    const gid = btn.closest("[data-latch-proxy-gid]")?.dataset.latchProxyGid || "";
    const proxy = currentLatchProxies.find((p) => p.group_id === gid);
    if (!proxy)
        return;
    const action = btn.dataset.action;
    if (action === "edit") {
        fillLatchProxyForm(proxy);
        latchProxyNameInput.focus();
        return;
    }
    if (action === "versions") {
        try {
            const { response, data } = await fetchLatchProxyVersions(gid);
            if (!response.ok) {
                setStatusMessage(latchProxyStatus, data.error || "获取失败", "error");
                return;
            }
            const versions = data.versions || [];
            const pick = window.prompt(`代理 "${proxy.name}" 版本历史 (当前 v${proxy.version}):\n` +
                versions.map((v) => `v${v.version}  SHA1:${v.sha1.slice(0, 8)}  ${new Date(v.created_at).toLocaleString()}`).join("\n") +
                "\n\n输入要回滚到的版本号 (留空取消):");
            if (!pick)
                return;
            const ver = parseInt(pick, 10);
            if (!ver || ver === proxy.version) {
                setStatusMessage(latchProxyStatus, "版本未变", "default");
                return;
            }
            const { response: r2, data: d2 } = await rollbackLatchProxy(gid, ver);
            if (!r2.ok) {
                setStatusMessage(latchProxyStatus, d2.error || "回滚失败", "error");
                return;
            }
            setStatusMessage(latchProxyStatus, d2.message || "回滚成功", "success");
            await loadSiteAdminData();
        }
        catch {
            setStatusMessage(latchProxyStatus, t("common.networkErrorRetry"), "error");
        }
        return;
    }
    if (action === "delete") {
        if (!window.confirm(`确定删除代理 "${proxy.name}" 的所有版本吗？`))
            return;
        try {
            const { response, data } = await removeLatchProxy(gid);
            if (!response.ok) {
                setStatusMessage(latchProxyStatus, data.error || "删除失败", "error");
                return;
            }
            if (editingLatchProxyGroupId === gid)
                resetLatchProxyForm();
            setStatusMessage(latchProxyStatus, data.message || "已删除", "success");
            await loadSiteAdminData();
        }
        catch {
            setStatusMessage(latchProxyStatus, t("common.networkErrorRetry"), "error");
        }
    }
});
// — Rules source tab —
latchRuleSourceInlineBtn.addEventListener("click", () => {
    latchRuleInlineSection.hidden = false;
    latchRuleFileSection.hidden = true;
    latchRuleSourceInlineBtn.classList.add("active");
    latchRuleSourceFileBtn.classList.remove("active");
});
latchRuleSourceFileBtn.addEventListener("click", () => {
    latchRuleInlineSection.hidden = true;
    latchRuleFileSection.hidden = false;
    latchRuleSourceInlineBtn.classList.remove("active");
    latchRuleSourceFileBtn.classList.add("active");
});
// — Rule —
latchRuleResetBtn.addEventListener("click", resetLatchRuleForm);
latchRuleSubmitBtn.addEventListener("click", async () => {
    const name = latchRuleNameInput.value.trim();
    const content = latchRuleContentInput.value;
    if (!name) {
        setStatusMessage(latchRuleStatus, "请填写规则名称", "error");
        return;
    }
    latchRuleSubmitBtn.disabled = true;
    setStatusMessage(latchRuleStatus, editingLatchRuleGroupId ? "正在更新…" : "正在创建…");
    try {
        const { response, data } = editingLatchRuleGroupId
            ? await updateLatchRule(editingLatchRuleGroupId, { name, content })
            : await createLatchRule({ name, content });
        if (!response.ok) {
            setStatusMessage(latchRuleStatus, data.error || "保存失败", "error");
            return;
        }
        setStatusMessage(latchRuleStatus, data.message || (editingLatchRuleGroupId ? "规则已更新" : "规则已创建"), "success");
        resetLatchRuleForm();
        await loadSiteAdminData();
    }
    catch {
        setStatusMessage(latchRuleStatus, t("common.networkErrorRetry"), "error");
    }
    finally {
        latchRuleSubmitBtn.disabled = false;
    }
});
latchRuleUploadBtn.addEventListener("click", async () => {
    const name = latchRuleNameInput.value.trim();
    const file = latchRuleFileInput.files?.[0];
    if (!file) {
        setStatusMessage(latchRuleStatus, "请先选择文件", "error");
        return;
    }
    const fd = new FormData();
    if (name)
        fd.append("name", name);
    fd.append("file", file);
    latchRuleUploadBtn.disabled = true;
    setStatusMessage(latchRuleStatus, "正在上传…");
    try {
        const { response, data } = editingLatchRuleGroupId
            ? await uploadLatchRuleFile(editingLatchRuleGroupId, fd)
            : await createLatchRuleFromFile(fd);
        if (!response.ok) {
            setStatusMessage(latchRuleStatus, data.error || "上传失败", "error");
            return;
        }
        setStatusMessage(latchRuleStatus, data.message || "上传成功", "success");
        resetLatchRuleForm();
        await loadSiteAdminData();
    }
    catch {
        setStatusMessage(latchRuleStatus, t("common.networkErrorRetry"), "error");
    }
    finally {
        latchRuleUploadBtn.disabled = false;
    }
});
latchRuleList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn)
        return;
    const gid = btn.closest("[data-latch-rule-gid]")?.dataset.latchRuleGid || "";
    const rule = currentLatchRules.find((r) => r.group_id === gid);
    if (!rule)
        return;
    const action = btn.dataset.action;
    if (action === "edit") {
        fillLatchRuleForm(rule);
        latchRuleNameInput.focus();
        return;
    }
    if (action === "versions") {
        try {
            const { response, data } = await fetchLatchRuleVersions(gid);
            if (!response.ok) {
                setStatusMessage(latchRuleStatus, data.error || "获取失败", "error");
                return;
            }
            const versions = data.versions || [];
            const pick = window.prompt(`规则 "${rule.name}" 版本历史 (当前 v${rule.version}):\n` +
                versions.map((v) => `v${v.version}  SHA1:${v.sha1.slice(0, 8)}  ${new Date(v.created_at).toLocaleString()}`).join("\n") +
                "\n\n输入要回滚到的版本号 (留空取消):");
            if (!pick)
                return;
            const ver = parseInt(pick, 10);
            if (!ver || ver === rule.version) {
                setStatusMessage(latchRuleStatus, "版本未变", "default");
                return;
            }
            const { response: r2, data: d2 } = await rollbackLatchRule(gid, ver);
            if (!r2.ok) {
                setStatusMessage(latchRuleStatus, d2.error || "回滚失败", "error");
                return;
            }
            setStatusMessage(latchRuleStatus, d2.message || "回滚成功", "success");
            await loadSiteAdminData();
        }
        catch {
            setStatusMessage(latchRuleStatus, t("common.networkErrorRetry"), "error");
        }
        return;
    }
    if (action === "delete") {
        if (!window.confirm(`确定删除规则 "${rule.name}" 的所有版本吗？`))
            return;
        try {
            const { response, data } = await removeLatchRule(gid);
            if (!response.ok) {
                setStatusMessage(latchRuleStatus, data.error || "删除失败", "error");
                return;
            }
            if (editingLatchRuleGroupId === gid)
                resetLatchRuleForm();
            setStatusMessage(latchRuleStatus, data.message || "已删除", "success");
            await loadSiteAdminData();
        }
        catch {
            setStatusMessage(latchRuleStatus, t("common.networkErrorRetry"), "error");
        }
    }
});
// — Profile —
latchProfileResetBtn.addEventListener("click", resetLatchProfileForm);
latchProfileSubmitBtn.addEventListener("click", async () => {
    const name = latchProfileNameInput.value.trim();
    if (!name) {
        setStatusMessage(latchProfileStatus, "请填写配置名称", "error");
        return;
    }
    const proxyGroupIds = Array.from(latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
    const ruleRadio = latchProfileRuleRadios.querySelector("input[type=radio]:checked");
    const ruleGroupId = ruleRadio?.value || "";
    const payload = {
        name,
        description: latchProfileDescInput.value.trim(),
        proxy_group_ids: proxyGroupIds,
        rule_group_id: ruleGroupId,
        enabled: latchProfileEnabledInput.checked,
        shareable: latchProfileShareableInput.checked,
    };
    latchProfileSubmitBtn.disabled = true;
    setStatusMessage(latchProfileStatus, editingLatchProfileId ? "正在更新…" : "正在创建…");
    try {
        const { response, data } = editingLatchProfileId
            ? await updateLatchProfile(editingLatchProfileId, payload)
            : await createLatchProfile(payload);
        if (!response.ok) {
            setStatusMessage(latchProfileStatus, data.error || "保存失败", "error");
            return;
        }
        setStatusMessage(latchProfileStatus, data.message || (editingLatchProfileId ? "配置已更新" : "配置已创建"), "success");
        resetLatchProfileForm();
        await loadSiteAdminData();
    }
    catch {
        setStatusMessage(latchProfileStatus, t("common.networkErrorRetry"), "error");
    }
    finally {
        latchProfileSubmitBtn.disabled = false;
    }
});
latchProfileList.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn)
        return;
    const id = btn.closest("[data-latch-profile-id]")?.dataset.latchProfileId || "";
    const prof = currentLatchProfiles.find((p) => p.id === id);
    if (!prof)
        return;
    const action = btn.dataset.action;
    if (action === "edit") {
        fillLatchProfileForm(prof);
        latchProfileNameInput.focus();
        return;
    }
    if (action === "delete") {
        if (!window.confirm(`确定删除配置 "${prof.name}" 吗？`))
            return;
        try {
            const { response, data } = await removeLatchProfile(id);
            if (!response.ok) {
                setStatusMessage(latchProfileStatus, data.error || "删除失败", "error");
                return;
            }
            if (editingLatchProfileId === id)
                resetLatchProfileForm();
            setStatusMessage(latchProfileStatus, data.message || "已删除", "success");
            await loadSiteAdminData();
        }
        catch {
            setStatusMessage(latchProfileStatus, t("common.networkErrorRetry"), "error");
        }
    }
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
    if (!payload.base_url || !payload.model || !payload.api_key) {
        setStatusMessage(llmConfigStatus, t("dashboard.llmTestMissingFields"), "error");
        return;
    }
    llmConfigTestBtn.disabled = true;
    llmConfigSubmitBtn.disabled = true;
    setStatusMessage(llmConfigStatus, t("dashboard.llmTesting"));
    try {
        const { response, data } = await testLLMConfig(payload);
        setStatusMessage(llmConfigStatus, response.ok ? data.message || t("dashboard.llmTestSuccess") : data.error || t("dashboard.llmTestFailed"), response.ok ? "success" : "error");
    }
    catch {
        setStatusMessage(llmConfigStatus, t("common.networkErrorRetry"), "error");
    }
    finally {
        llmConfigTestBtn.disabled = false;
        llmConfigSubmitBtn.disabled = false;
    }
});
botUserResetBtn.addEventListener("click", () => {
    resetBotUserForm();
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
            ? await updateLLMConfig(editingLLMConfigId, {
                ...payload,
                update_api_key: payload.api_key !== "",
            })
            : await createLLMConfig(payload);
        if (!response.ok) {
            llmConfigStatus.textContent = data.error || t("common.saveFailed");
            return;
        }
        llmConfigStatus.textContent = editingLLMConfigId ? t("dashboard.llmConfigUpdated") : t("dashboard.llmConfigCreated");
        resetLLMConfigForm();
        await loadSiteAdminData();
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
    if (!button) {
        return;
    }
    const item = button.closest("[data-llm-config-id]");
    const configID = Number(item?.dataset.llmConfigId || 0);
    const config = currentLLMConfigs.find((entry) => entry.id === configID);
    if (!config) {
        return;
    }
    const action = button.dataset.action;
    if (action === "edit") {
        editingLLMConfigId = config.id;
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
        if (!window.confirm(t("dashboard.confirmDeleteConfig", { name: config.name }))) {
            return;
        }
        const { response, data } = await removeLLMConfig(config.id);
        if (!response.ok) {
            llmConfigStatus.textContent = data.error || t("common.deleteFailed");
            return;
        }
        llmConfigStatus.textContent = t("dashboard.configDeleted", { name: config.name });
        resetLLMConfigForm();
        await loadSiteAdminData();
    }
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
        await loadSiteAdminData();
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
    if (!button) {
        return;
    }
    const item = button.closest("[data-bot-user-id]");
    const botID = Number(item?.dataset.botUserId || 0);
    const bot = currentBotUsers.find((entry) => entry.id === botID);
    if (!bot) {
        return;
    }
    const action = button.dataset.action;
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
        if (!window.confirm(t("dashboard.confirmDeleteBot", { name: bot.name }))) {
            return;
        }
        const { response, data } = await removeBotUser(bot.id);
        if (!response.ok) {
            botUserStatus.textContent = data.error || t("common.deleteFailed");
            return;
        }
        botUserStatus.textContent = t("dashboard.botDeleted", { name: bot.name });
        resetBotUserForm();
        await loadSiteAdminData();
    }
});
saveSiteBtn.addEventListener("click", async () => {
    siteStatus.textContent = t("dashboard.savingSiteInfo");
    saveSiteBtn.disabled = true;
    try {
        const { response, data } = await updateSiteSettings({
            name: siteNameInput.value.trim(),
            description: siteDescriptionInput.value.trim(),
            icon_url: siteIconPreview.src,
        });
        if (!response.ok) {
            siteStatus.textContent = data.error || t("common.saveFailed");
            return;
        }
        renderSiteSettings(data.site);
        siteStatus.textContent = t("dashboard.siteInfoSaved");
    }
    catch {
        siteStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        saveSiteBtn.disabled = false;
    }
});
siteIconFile.addEventListener("change", async () => {
    const file = siteIconFile.files?.[0];
    if (!file) {
        return;
    }
    if (!file.type.startsWith("image/")) {
        siteStatus.textContent = t("dashboard.selectImageFile");
        siteIconFile.value = "";
        return;
    }
    siteStatus.textContent = t("dashboard.uploadingSiteIcon");
    const formData = new FormData();
    formData.append("icon", file);
    try {
        const { response, data } = await uploadSiteIcon(formData);
        if (!response.ok) {
            siteStatus.textContent = data.error || t("common.submitFailed");
            return;
        }
        renderSiteSettings(data.site);
        siteIconPreview.src = `${data.icon_url || data.site?.icon_url || ""}?v=${Date.now()}`;
        siteStatus.textContent = t("dashboard.siteIconUpdated");
    }
    catch {
        siteStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        siteIconFile.value = "";
    }
});
async function handleApplePushCertificateUpload(environment, fileInput) {
    const file = fileInput.files?.[0];
    if (!file) {
        return;
    }
    const lowerName = file.name.toLowerCase();
    if (![".p8", ".p12", ".pem", ".cer", ".crt", ".key"].some((ext) => lowerName.endsWith(ext))) {
        siteStatus.textContent = t("dashboard.certUnsupportedFormat");
        fileInput.value = "";
        return;
    }
    siteStatus.textContent = t("dashboard.uploadingCert", { env: environment });
    const formData = new FormData();
    formData.append("certificate", file);
    try {
        const { response, data } = await uploadApplePushCertificate(environment, formData);
        if (!response.ok) {
            siteStatus.textContent = data.error || t("common.submitFailed");
            return;
        }
        renderSiteSettings(data.site);
        siteStatus.textContent = t("dashboard.certUpdated", { env: environment });
    }
    catch {
        siteStatus.textContent = t("common.networkErrorRetry");
    }
    finally {
        fileInput.value = "";
    }
}
async function handleApplePushCertificateDelete(environment) {
    if (!window.confirm(t("dashboard.confirmDeleteCert", { env: environment }))) {
        return;
    }
    siteStatus.textContent = t("dashboard.deletingCert", { env: environment });
    try {
        const { response, data } = await deleteApplePushCertificate(environment);
        if (!response.ok) {
            siteStatus.textContent = data.error || t("common.deleteFailed");
            return;
        }
        renderSiteSettings(data.site);
        siteStatus.textContent = t("dashboard.certDeleted", { env: environment });
    }
    catch {
        siteStatus.textContent = t("common.networkErrorRetry");
    }
}
applePushDevFile.addEventListener("change", async () => {
    await handleApplePushCertificateUpload("dev", applePushDevFile);
});
applePushProdFile.addEventListener("change", async () => {
    await handleApplePushCertificateUpload("prod", applePushProdFile);
});
applePushDevDeleteBtn.addEventListener("click", async () => {
    await handleApplePushCertificateDelete("dev");
});
applePushProdDeleteBtn.addEventListener("click", async () => {
    await handleApplePushCertificateDelete("prod");
});
logoutBtn.addEventListener("click", async () => {
    logoutBtn.disabled = true;
    try {
        const response = await logout();
        if (!response.ok) {
            welcomeText.textContent = t("dashboard.logoutFailed");
            return;
        }
        window.location.replace("/login.html");
    }
    catch {
        welcomeText.textContent = t("dashboard.logoutNetworkFailed");
    }
    finally {
        logoutBtn.disabled = false;
    }
});
newEntryBtn.addEventListener("click", () => {
    window.location.href = "/editor.html";
});
loadMoreBtn.addEventListener("click", () => {
    void loadEntries();
});
drawerToggleBtn.addEventListener("click", () => {
    setDrawerOpen(!entryDrawer.classList.contains("open"));
});
drawerCloseBtn.addEventListener("click", () => {
    setDrawerOpen(false);
});
drawerBackdrop.addEventListener("click", () => {
    setDrawerOpen(false);
});
window.addEventListener("resize", () => {
    if (!isMobileLayout()) {
        setDrawerOpen(false);
    }
});
editBtn.addEventListener("click", () => {
    if (!activeEntryId) {
        return;
    }
    window.location.href = `/editor.html?id=${activeEntryId}`;
});
deleteBtn.addEventListener("click", async () => {
    if (!activeEntryId) {
        return;
    }
    if (!window.confirm(t("dashboard.confirmDeleteEntry"))) {
        return;
    }
    const response = await deleteEntry(activeEntryId);
    if (response.ok) {
        activeEntryId = null;
        entryContent.textContent = t("dashboard.selectEntry");
        await loadEntries(true);
    }
});
iconFile.addEventListener("change", () => {
    const file = iconFile.files?.[0];
    if (!file) {
        return;
    }
    if (!file.type.startsWith("image/")) {
        iconStatus.textContent = t("dashboard.selectImageFileWithPeriod");
        return;
    }
    const reader = new FileReader();
    reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") {
            return;
        }
        const img = new Image();
        img.onload = () => {
            iconImage = img;
            baseScale = Math.max(iconCanvas.width / img.width, iconCanvas.height / img.height);
            zoomValue = 1;
            offsetX = 0;
            offsetY = 0;
            iconZoom.value = "1";
            iconEditor.classList.add("active");
            drawIconPreview();
        };
        img.src = result;
    };
    reader.readAsDataURL(file);
});
iconZoom.addEventListener("input", () => {
    zoomValue = Number(iconZoom.value);
    drawIconPreview();
});
iconCanvas.addEventListener("mousedown", (event) => {
    startDrag(event.clientX, event.clientY);
});
window.addEventListener("mousemove", (event) => {
    moveDrag(event.clientX, event.clientY);
});
window.addEventListener("mouseup", stopDrag);
iconCanvas.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    if (!touch) {
        return;
    }
    startDrag(touch.clientX, touch.clientY);
});
window.addEventListener("touchmove", (event) => {
    const touch = event.touches[0];
    if (!touch) {
        return;
    }
    moveDrag(touch.clientX, touch.clientY);
});
window.addEventListener("touchend", stopDrag);
window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
        return;
    }
    if (tagModal.classList.contains("open")) {
        closeTagModal();
    }
    if (siteAdminModal.classList.contains("open")) {
        closeSiteAdminModal();
    }
});
cancelIconBtn.addEventListener("click", () => {
    iconEditor.classList.remove("active");
    iconFile.value = "";
    iconStatus.textContent = t("dashboard.canceledEdit");
});
saveIconBtn.addEventListener("click", async () => {
    if (!iconImage) {
        return;
    }
    iconStatus.textContent = t("common.uploading");
    iconCanvas.toBlob(async (blob) => {
        if (!blob) {
            iconStatus.textContent = t("dashboard.generatingImageFailed");
            return;
        }
        const formData = new FormData();
        formData.append("icon", blob, "icon.png");
        try {
            const { response, data } = await uploadUserIcon(formData);
            if (!response.ok) {
                iconStatus.textContent = data.error || t("common.submitFailed");
                return;
            }
            const nextAvatar = `${data.icon_url || ""}?v=${Date.now()}`;
            userIcon.src = nextAvatar;
            settingsCardAvatar.src = nextAvatar;
            iconEditor.classList.remove("active");
            iconFile.value = "";
            iconStatus.textContent = t("dashboard.avatarUpdated");
        }
        catch {
            iconStatus.textContent = t("dashboard.networkErrorPeriod");
        }
    }, "image/png", 0.92);
});
themeToggleBtn.addEventListener("click", () => {
    const currentTheme = document.documentElement.dataset.theme === "mono" ? "mono" : "default";
    const nextTheme = applyTheme(currentTheme === "mono" ? "default" : "mono", true);
    syncThemeButton(nextTheme);
});
passkeyRegisterBtn.addEventListener("click", async () => {
    if (!window.PublicKeyCredential) {
        setStatusMessage(passkeyStatus, "当前浏览器不支持 Passkey。", "error");
        return;
    }
    setStatusMessage(passkeyStatus, "正在启动 Passkey...");
    try {
        const { response: beginResponse, data: beginResult } = await beginPasskeyRegistration();
        if (!beginResponse.ok) {
            setStatusMessage(passkeyStatus, beginResult.error || "无法发起 Passkey 绑定", "error");
            return;
        }
        const publicKey = beginResult.publicKey;
        publicKey.challenge = base64URLToBuffer(publicKey.challenge);
        publicKey.user.id = base64URLToBuffer(publicKey.user.id);
        if (publicKey.excludeCredentials) {
            publicKey.excludeCredentials = publicKey.excludeCredentials.map((cred) => ({
                ...cred,
                id: base64URLToBuffer(cred.id),
            }));
        }
        const credential = await navigator.credentials.create({
            publicKey: publicKey,
        });
        const payload = credentialToJSON(credential);
        const { response: finishResponse, data: finishResult } = await finishPasskeyRegistration(beginResult.session_id || "", payload);
        if (!finishResponse.ok) {
            setStatusMessage(passkeyStatus, finishResult.error || "Passkey 绑定失败", "error");
            return;
        }
        renderPasskeys(finishResult.credentials || []);
        setStatusMessage(passkeyStatus, finishResult.message || "Passkey 绑定成功！", "success");
    }
    catch {
        setStatusMessage(passkeyStatus, "网络错误，请重试", "error");
    }
});
sendEmailVerificationBtn.addEventListener("click", () => {
    void handleEmailVerificationSend();
});
const initialTheme = initStoredTheme();
resetLatchProxyForm();
resetLatchRuleForm();
resetLatchProfileForm();
switchLatchTab("proxies");
syncThemeButton(initialTheme);
bindThemeSync(syncThemeButton);
switchSettingsSection(activeSettingsSection);
void (async () => {
    await hydrateSiteBrand();
    await loadProfile();
    await Promise.all([loadEntries(true), loadLoginHistory(), loadPasskeys(), loadSiteAdminData()]);
})();
