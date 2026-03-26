import { byId } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";

const titleEl = byId<HTMLElement>("markdownTitle");
const metaEl = byId<HTMLElement>("markdownMeta");
const alertBox = byId<HTMLElement>("markdownAlert");
const contentEl = byId<HTMLElement>("markdownContent");
const entryId = new URLSearchParams(window.location.search).get("id");

initStoredTheme();
bindThemeSync();

function applyMarkdownPayload(data: { entry?: { title?: string; is_public?: boolean }; content?: string }): void {
  titleEl.textContent = data.entry?.title || t("markdown.title");
  metaEl.textContent = data.entry?.is_public ? t("markdown.publicReadOnly") : t("markdown.readOnlyPreview");
  contentEl.innerHTML = renderMarkdown(data.content || "");
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

void hydrateSiteBrand();
void loadPublicMarkdown();
