import { byId } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";

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
const entryId = new URLSearchParams(window.location.search).get("id");

let canEdit = true;

initStoredTheme();
bindThemeSync();

async function ensureLogin(): Promise<void> {
  const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
  if (!res.ok) {
    window.location.href = "/login.html";
  }
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
  saveBtn.hidden = readonly;
  saveBtn.disabled = readonly;
  welcomeText.textContent = readonly ? t("editor.publicPreview") : entryId ? t("editor.editEntry") : t("editor.newEntry");
  updatePublicHint();
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
void hydrateSiteBrand();
