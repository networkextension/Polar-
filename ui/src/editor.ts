import { byId } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";
import { logout } from "./api/session.js";
import { assistMarkdownWithBot, fetchAvailableLLMConfigs, fetchBotUsers } from "./api/dashboard.js";
import type { BotUser, LLMConfig } from "./types/dashboard.js";

const API_BASE = "";
const alertBox = byId<HTMLElement>("alert");
const titleInput = byId<HTMLInputElement>("titleInput");
const contentInput = byId<HTMLTextAreaElement>("contentInput");
const preview = byId<HTMLElement>("preview");
const saveBtn = byId<HTMLButtonElement>("saveBtn");
const backBtn = byId<HTMLButtonElement>("backBtn");
const welcomeText = byId<HTMLElement>("welcomeText");
const publicToggle = byId<HTMLInputElement>("publicToggle");
const publicHint = byId<HTMLElement>("publicHint");
const assistBotSelect = byId<HTMLSelectElement>("assistBotSelect");
const assistLLMSelect = byId<HTMLSelectElement>("assistLLMSelect");
const assistInstructionInput = byId<HTMLTextAreaElement>("assistInstructionInput");
const assistRunBtn = byId<HTMLButtonElement>("assistRunBtn");
const assistApplyBtn = byId<HTMLButtonElement>("assistApplyBtn");
const assistDiffBtn = byId<HTMLButtonElement>("assistDiffBtn");
const assistStatus = byId<HTMLElement>("assistStatus");
const assistPreview = byId<HTMLElement>("assistPreview");
const assistDiff = byId<HTMLElement>("assistDiff");
const entryId = new URLSearchParams(window.location.search).get("id");

let canEdit = true;
let assistResultContent = "";
let assistSourceContent = "";
let assistDiffVisible = false;
let currentBots: BotUser[] = [];
let currentLLMConfigs: LLMConfig[] = [];

initStoredTheme();
bindThemeSync();

async function ensureLogin(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
  if (!res.ok) {
    window.location.href = "/login.html";
    return;
  }
  const data = await res.json();
  renderSidebarFoot(data);
}

function getPublicUrl(): string {
  if (!entryId) {
    return "";
  }
  return `${window.location.origin}/markdown.html?id=${encodeURIComponent(entryId)}`;
}

function updatePublicHint(): void {
  if (!canEdit) {
    publicHint.textContent = publicToggle.checked
      ? t("editor.publicReadOnly", { url: getPublicUrl() })
      : t("editor.readOnly");
    return;
  }

  if (!publicToggle.checked) {
    publicHint.textContent = t("editor.publicByDefault");
    return;
  }

  publicHint.textContent = entryId
    ? t("editor.publicUrl", { url: getPublicUrl() })
    : t("editor.publicAfterSave");
}

function renderPreview(): void {
  const raw = contentInput.value.trim();
  if (!raw) {
    preview.textContent = t("editor.noContent");
    return;
  }
  preview.innerHTML = renderMarkdown(raw);
}

function applyReadonlyState(readonly: boolean): void {
  canEdit = !readonly;
  titleInput.disabled = readonly;
  contentInput.disabled = readonly;
  publicToggle.disabled = readonly;
  assistBotSelect.disabled = readonly;
  assistLLMSelect.disabled = readonly;
  assistInstructionInput.disabled = readonly;
  assistRunBtn.disabled = readonly;
  assistApplyBtn.disabled = readonly || !assistResultContent;
  assistDiffBtn.disabled = readonly || !assistResultContent;
  saveBtn.hidden = readonly;
  saveBtn.disabled = readonly;
  welcomeText.textContent = readonly ? t("editor.publicPreview") : entryId ? t("editor.editEntry") : t("editor.newEntry");
  updatePublicHint();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildLineDiffHtml(beforeText: string, afterText: string): string {
  const before = beforeText.split("\n");
  const after = afterText.split("\n");
  const max = Math.max(before.length, after.length);
  const lines: string[] = [];
  for (let i = 0; i < max; i += 1) {
    const oldLine = before[i];
    const newLine = after[i];
    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        lines.push(`<div style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;color:#6b7280;">  ${escapeHtml(oldLine)}</div>`);
      }
      continue;
    }
    if (oldLine !== undefined) {
      lines.push(`<div style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;background:#fff1f2;color:#9f1239;">- ${escapeHtml(oldLine)}</div>`);
    }
    if (newLine !== undefined) {
      lines.push(`<div style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, monospace;background:#f0fdf4;color:#166534;">+ ${escapeHtml(newLine)}</div>`);
    }
  }
  if (!lines.length) {
    return `<div class="status-text">原文与润色结果一致</div>`;
  }
  return lines.join("");
}

function renderAssistPreview(): void {
  if (!assistResultContent.trim()) {
    assistPreview.textContent = "暂无润色结果";
    return;
  }
  assistPreview.innerHTML = renderMarkdown(assistResultContent);
}

function renderAssistDiff(): void {
  if (!assistResultContent.trim()) {
    assistDiff.textContent = "暂无差异结果";
    return;
  }
  assistDiff.innerHTML = buildLineDiffHtml(assistSourceContent, assistResultContent);
}

function renderAssistOptions(): void {
  if (!currentBots.length) {
    assistBotSelect.innerHTML = `<option value="">暂无可用 Bot</option>`;
    assistRunBtn.disabled = true;
  } else {
    assistBotSelect.innerHTML = currentBots
      .map((bot) => `<option value="${bot.id}">${bot.name} · ${bot.config_name || "Default"}</option>`)
      .join("");
    assistRunBtn.disabled = !canEdit;
  }

  const llmOptions = currentLLMConfigs
    .map((cfg) => `<option value="${cfg.id}">${cfg.name} · ${cfg.model}</option>`)
    .join("");
  assistLLMSelect.innerHTML = `<option value="">跟随 Bot 默认配置</option>${llmOptions}`;
}

async function loadAssistOptions(): Promise<void> {
  assistStatus.textContent = "";
  try {
    const [botResult, llmResult] = await Promise.all([fetchBotUsers(), fetchAvailableLLMConfigs()]);
    currentBots = botResult.response.ok ? (botResult.data.bots || []) : [];
    currentLLMConfigs = llmResult.response.ok ? (llmResult.data.configs || []) : [];
    renderAssistOptions();
  } catch {
    assistStatus.textContent = "加载润色助手配置失败，请稍后重试";
    assistRunBtn.disabled = true;
  }
}

async function loadEntry(): Promise<void> {
  if (!entryId) {
    updatePublicHint();
    return;
  }

  const res = await fetch(`${API_BASE}/api/markdown/${entryId}`, {
    credentials: "include",
  });
  if (!res.ok) {
    alertBox.className = "alert error";
    alertBox.textContent = t("editor.loadFailed");
    return;
  }

  const data = await res.json();
  titleInput.value = data.entry ? data.entry.title : "";
  contentInput.value = data.content || "";
  publicToggle.checked = Boolean(data.entry?.is_public);
  renderPreview();
  applyReadonlyState(data.can_edit === false);

  if (!canEdit) {
    alertBox.className = "alert success";
    alertBox.textContent = t("editor.readingPublic");
  }
}

contentInput.addEventListener("input", renderPreview);
publicToggle.addEventListener("change", updatePublicHint);
assistRunBtn.addEventListener("click", async () => {
  if (!canEdit) {
    return;
  }
  const botID = Number(assistBotSelect.value || 0);
  if (botID <= 0) {
    assistStatus.textContent = "请先选择一个 Bot";
    return;
  }
  const sourceContent = contentInput.value.trim();
  if (!sourceContent) {
    assistStatus.textContent = "请先输入正文，再进行润色";
    return;
  }

  assistRunBtn.disabled = true;
  assistApplyBtn.disabled = true;
  assistDiffBtn.disabled = true;
  assistStatus.textContent = "正在润色，请稍候...";
  try {
    const selectedLLMID = Number(assistLLMSelect.value || 0);
    const { response, data } = await assistMarkdownWithBot({
      bot_id: botID,
      llm_config_id: selectedLLMID > 0 ? selectedLLMID : undefined,
      title: titleInput.value.trim(),
      content: sourceContent,
      instruction: assistInstructionInput.value.trim(),
    });
    if (!response.ok || !data.content) {
      assistStatus.textContent = data.error || t("common.saveFailed");
      assistResultContent = "";
      assistSourceContent = "";
      renderAssistPreview();
      renderAssistDiff();
      return;
    }
    assistSourceContent = sourceContent;
    assistResultContent = data.content;
    renderAssistPreview();
    renderAssistDiff();
    const llmLabel = data.llm?.model ? ` · ${data.llm.model}` : "";
    assistStatus.textContent = `润色完成${llmLabel}`;
    assistApplyBtn.disabled = false;
    assistDiffBtn.disabled = false;
  } catch {
    assistStatus.textContent = t("common.networkError");
  } finally {
    assistRunBtn.disabled = !canEdit || currentBots.length === 0;
  }
});

assistApplyBtn.addEventListener("click", () => {
  if (!assistResultContent || !canEdit) {
    return;
  }
  contentInput.value = assistResultContent;
  renderPreview();
  assistStatus.textContent = "已应用润色结果到正文";
});

assistDiffBtn.addEventListener("click", () => {
  assistDiffVisible = !assistDiffVisible;
  assistDiff.hidden = !assistDiffVisible;
  assistDiffBtn.textContent = assistDiffVisible ? "收起差异" : "查看差异";
  if (assistDiffVisible) {
    renderAssistDiff();
  }
});

saveBtn.addEventListener("click", async () => {
  alertBox.className = "alert";
  alertBox.textContent = "";

  const title = titleInput.value.trim();
  const content = contentInput.value.trim();
  if (!title || !content) {
    alertBox.className = "alert error";
    alertBox.textContent = t("editor.titleContentRequired");
    return;
  }

  try {
    const targetUrl = entryId ? `${API_BASE}/api/markdown/${entryId}` : `${API_BASE}/api/markdown`;
    const method = entryId ? "PUT" : "POST";
    const res = await fetch(targetUrl, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title,
        content,
        is_public: publicToggle.checked,
      }),
    });
    const data = await res.json();

    if (!res.ok) {
      alertBox.className = "alert error";
      alertBox.textContent = data.error || t("common.saveFailed");
      return;
    }

    alertBox.className = "alert success";
    alertBox.textContent = entryId
      ? t("editor.updateSuccess")
      : t("editor.saveSuccess", { id: String(data.id) });
    window.location.href = "/dashboard.html";
  } catch {
    alertBox.className = "alert error";
    alertBox.textContent = t("common.networkError");
  }
});

backBtn.addEventListener("click", () => {
  window.location.href = "/dashboard.html";
});

void ensureLogin();
void loadEntry();
void loadAssistOptions();
void hydrateSiteBrand();

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await logout(); } finally { window.location.replace("/login.html"); }
});
