import { byId } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";
import { logout } from "./api/session.js";

const titleEl = byId<HTMLElement>("markdownTitle");
const metaEl = byId<HTMLElement>("markdownMeta");
const alertBox = byId<HTMLElement>("markdownAlert");
const contentEl = byId<HTMLElement>("markdownContent");
const copyMdBtn = byId<HTMLButtonElement>("markdownCopyMdBtn");
const copyHtmlBtn = byId<HTMLButtonElement>("markdownCopyHtmlBtn");
const entryId = new URLSearchParams(window.location.search).get("id");

initStoredTheme();
bindThemeSync();

let rawMarkdown = "";

function applyMarkdownPayload(data: { entry?: { title?: string; is_public?: boolean }; content?: string }): void {
  titleEl.textContent = data.entry?.title || t("markdown.title");
  metaEl.textContent = data.entry?.is_public ? t("markdown.publicReadOnly") : t("markdown.readOnlyPreview");
  rawMarkdown = data.content || "";
  contentEl.innerHTML = renderMarkdown(rawMarkdown);
  copyMdBtn.disabled = false;
  copyHtmlBtn.disabled = false;
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the textarea fallback — some browsers block
      // clipboard writes without an explicit user gesture context,
      // which shouldn't happen here but we still want a safety net.
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function runCopy(button: HTMLButtonElement, buildPayload: () => string, defaultLabel: string): Promise<void> {
  const text = buildPayload();
  if (!text.trim()) {
    return;
  }
  const ok = await writeClipboard(text);
  const originalLabel = button.textContent || defaultLabel;
  button.textContent = ok ? t("markdown.copied") : t("markdown.copyFailed");
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.disabled = false;
  }, 1500);
}

async function requestMarkdown(path: string): Promise<{ ok: boolean; status: number; data: any }> {
  const response = await fetch(path, { credentials: "include" });
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

async function loadPublicMarkdown(): Promise<void> {
  if (!entryId) {
    alertBox.className = "alert error";
    alertBox.textContent = t("markdown.missingId");
    contentEl.textContent = t("markdown.loadContentFailed");
    return;
  }

  try {
    const publicResult = await requestMarkdown(`/api/public/markdown/${encodeURIComponent(entryId)}`);
    if (publicResult.ok) {
      applyMarkdownPayload(publicResult.data);
      return;
    }

    if (publicResult.status === 404) {
      const authResult = await requestMarkdown(`/api/markdown/${encodeURIComponent(entryId)}`);
      if (authResult.ok) {
        applyMarkdownPayload(authResult.data);
        metaEl.textContent = t("markdown.authReadOnlyPreview");
        return;
      }
    }

    alertBox.className = "alert error";
    alertBox.textContent = publicResult.data.error || t("markdown.loadFailed");
    contentEl.textContent = t("markdown.notFound");
  } catch {
    alertBox.className = "alert error";
    alertBox.textContent = t("common.networkError");
    contentEl.textContent = t("markdown.loadError");
  }
}

copyMdBtn.disabled = true;
copyHtmlBtn.disabled = true;

copyMdBtn.addEventListener("click", () => {
  void runCopy(copyMdBtn, () => rawMarkdown, t("markdown.copyMarkdown"));
});

copyHtmlBtn.addEventListener("click", () => {
  void runCopy(copyHtmlBtn, () => contentEl.innerHTML, t("markdown.copyHtml"));
});

void hydrateSiteBrand();
void loadPublicMarkdown();

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await logout(); } finally { window.location.replace("/login.html"); }
});

