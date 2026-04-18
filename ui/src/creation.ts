import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { assistMarkdownWithBot, fetchAvailableLLMConfigs, fetchBotUsers } from "./api/dashboard.js";
import { fetchCurrentUser, logout } from "./api/session.js";
import { byId } from "./lib/dom.js";
import { t } from "./lib/i18n.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import type { BotUser, LLMConfig } from "./types/dashboard.js";

const API_BASE = "";

const alertBox = byId<HTMLElement>("alert");
const statusBadge = byId<HTMLElement>("creationStatus");
const titleInput = byId<HTMLInputElement>("creationTitle");
const editorHost = byId<HTMLElement>("creationEditor");
const saveBtn = byId<HTMLButtonElement>("creationSaveBtn");
const publicBtn = byId<HTMLButtonElement>("creationPublicToggleBtn");

const bubble = byId<HTMLElement>("creationAssistBubble");
const bubbleBot = byId<HTMLSelectElement>("creationAssistBot");
const bubbleLLM = byId<HTMLSelectElement>("creationAssistLLM");
const bubbleInstruction = byId<HTMLInputElement>("creationAssistInstruction");
const bubbleStatus = byId<HTMLElement>("creationAssistStatus");
const bubblePreview = byId<HTMLElement>("creationAssistPreview");
const bubbleApplyRow = byId<HTMLElement>("creationAssistApply");
const bubbleRunBtn = byId<HTMLButtonElement>("creationAssistRunBtn");
const bubbleCloseBtn = byId<HTMLButtonElement>("creationAssistCloseBtn");
const bubbleApplyBtn = byId<HTMLButtonElement>("creationAssistApplyBtn");
const bubbleDiscardBtn = byId<HTMLButtonElement>("creationAssistDiscardBtn");

const entryId = new URLSearchParams(window.location.search).get("id");

initStoredTheme();
bindThemeSync();

let editor: Editor | null = null;
let isPublic = false;
let currentBots: BotUser[] = [];
let currentLLMConfigs: LLMConfig[] = [];
let savedSelection: { from: number; to: number; text: string } | null = null;
let pendingResult = "";

const presetInstructions: Record<string, string> = {
  tighter: "压缩到最紧凑，保留原意与关键事实，删除所有冗余与重复。",
  formal: "把措辞调整得更书面、更专业，但保留原文核心观点与立场。",
  friendly: "改得更轻松亲切，像在跟朋友讲话，保留原观点与事实。",
  expand: "在不改变观点的前提下，补充一些合理的细节与说明，让段落更充实。",
};

function renderPublicLabel(): void {
  publicBtn.textContent = isPublic ? t("creation.makePrivate") : t("creation.makePublic");
}

function setStatus(message: string): void {
  statusBadge.textContent = message;
}

function setAlert(kind: "success" | "error" | "", message: string): void {
  alertBox.className = kind ? `alert ${kind}` : "alert";
  alertBox.textContent = message;
}

async function loadProfile(): Promise<void> {
  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
  renderSidebarFoot(data);
}

async function loadAssistOptions(): Promise<void> {
  try {
    const [botResult, llmResult] = await Promise.all([fetchBotUsers(), fetchAvailableLLMConfigs()]);
    currentBots = botResult.response.ok ? botResult.data.bots || [] : [];
    currentLLMConfigs = llmResult.response.ok ? llmResult.data.configs || [] : [];
  } catch {
    currentBots = [];
    currentLLMConfigs = [];
  }
  renderAssistOptions();
}

function renderAssistOptions(): void {
  if (!currentBots.length) {
    bubbleBot.innerHTML = `<option value="">${t("creation.assistNoBot")}</option>`;
    bubbleRunBtn.disabled = true;
  } else {
    bubbleBot.innerHTML = currentBots
      .map((bot) => `<option value="${bot.id}">${bot.name}${bot.config_name ? ` · ${bot.config_name}` : ""}</option>`)
      .join("");
    bubbleRunBtn.disabled = false;
  }
  const llmOptions = currentLLMConfigs
    .map((cfg) => `<option value="${cfg.id}">${cfg.name} · ${cfg.model}</option>`)
    .join("");
  bubbleLLM.innerHTML = `<option value="">${t("creation.assistDefaultLLM")}</option>${llmOptions}`;
}

function initEditor(initialMarkdown: string): void {
  editor = new Editor({
    element: editorHost,
    extensions: [StarterKit, Markdown.configure({ html: false, tightLists: true })],
    content: initialMarkdown || "",
    autofocus: "end",
    editorProps: {
      attributes: {
        class: "creation-prose",
        spellcheck: "false",
      },
    },
    onSelectionUpdate: ({ editor: ed }) => {
      const { from, to, empty } = ed.state.selection;
      if (empty || from === to) {
        hideBubble(true);
        return;
      }
      const text = ed.state.doc.textBetween(from, to, "\n", " ").trim();
      if (!text) {
        hideBubble(true);
        return;
      }
      savedSelection = { from, to, text };
      showBubble();
    },
    onBlur: () => {
      // keep bubble if user is interacting with it
      if (document.activeElement && bubble.contains(document.activeElement as Node)) {
        return;
      }
      hideBubble(false);
    },
  });
}

function showBubble(): void {
  bubble.hidden = false;
  positionBubble();
}

function hideBubble(resetResult: boolean): void {
  bubble.hidden = true;
  bubbleApplyRow.hidden = true;
  bubblePreview.hidden = true;
  bubblePreview.textContent = "";
  bubbleStatus.textContent = "";
  if (resetResult) {
    pendingResult = "";
  }
}

function positionBubble(): void {
  if (!editor) {
    return;
  }
  const { from, to } = editor.state.selection;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const rect = editorHost.getBoundingClientRect();
  const top = Math.max(start.top, end.top) - rect.top + (end.bottom - end.top) + 10;
  const left = ((start.left + end.left) / 2) - rect.left;
  bubble.style.top = `${top}px`;
  bubble.style.left = `${Math.max(12, left - bubble.offsetWidth / 2)}px`;
}

async function runPolish(instructionOverride?: string): Promise<void> {
  if (!editor || !savedSelection) {
    return;
  }
  const botID = Number(bubbleBot.value || 0);
  if (botID <= 0) {
    bubbleStatus.textContent = t("creation.assistBotRequired");
    return;
  }
  bubbleRunBtn.disabled = true;
  bubbleStatus.textContent = t("creation.assistRunning");
  pendingResult = "";
  bubblePreview.hidden = true;
  bubbleApplyRow.hidden = true;

  try {
    const llmID = Number(bubbleLLM.value || 0);
    const instruction = (instructionOverride || bubbleInstruction.value).trim();
    const { response, data } = await assistMarkdownWithBot({
      bot_id: botID,
      llm_config_id: llmID > 0 ? llmID : undefined,
      title: titleInput.value.trim(),
      content: savedSelection.text,
      instruction,
    });
    if (!response.ok || !data.content) {
      bubbleStatus.textContent = data.error || t("creation.assistFailed");
      return;
    }
    pendingResult = data.content.trim();
    bubblePreview.hidden = false;
    bubblePreview.textContent = pendingResult;
    bubbleApplyRow.hidden = false;
    const llmLabel = data.llm?.model ? ` · ${data.llm.model}` : "";
    bubbleStatus.textContent = `${t("creation.assistReady")}${llmLabel}`;
  } catch {
    bubbleStatus.textContent = t("common.networkError");
  } finally {
    bubbleRunBtn.disabled = !currentBots.length;
  }
}

function applyResult(): void {
  if (!editor || !savedSelection || !pendingResult) {
    return;
  }
  const { from, to } = savedSelection;
  editor
    .chain()
    .focus()
    .setTextSelection({ from, to })
    .insertContent(pendingResult)
    .run();
  hideBubble(true);
}

function getMarkdown(): string {
  if (!editor) {
    return "";
  }
  const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
  return storage.markdown?.getMarkdown ? storage.markdown.getMarkdown() : editor.getText();
}

async function loadEntry(): Promise<void> {
  if (!entryId) {
    setStatus(t("creation.newEntry"));
    initEditor("");
    return;
  }
  const res = await fetch(`${API_BASE}/api/markdown/${entryId}`, { credentials: "include" });
  if (!res.ok) {
    setAlert("error", t("creation.loadFailed"));
    initEditor("");
    return;
  }
  const data = await res.json();
  titleInput.value = data.entry?.title || "";
  isPublic = Boolean(data.entry?.is_public);
  renderPublicLabel();
  setStatus(t("creation.editEntry"));
  initEditor(data.content || "");
}

async function saveEntry(): Promise<void> {
  if (!editor) {
    return;
  }
  const title = titleInput.value.trim();
  const content = getMarkdown().trim();
  if (!title || !content) {
    setAlert("error", t("creation.titleContentRequired"));
    return;
  }
  setAlert("", "");
  saveBtn.disabled = true;
  try {
    const method = entryId ? "PUT" : "POST";
    const url = entryId ? `${API_BASE}/api/markdown/${entryId}` : `${API_BASE}/api/markdown`;
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title,
        content,
        is_public: isPublic,
        editor_mode: "rich",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAlert("error", data.error || t("creation.saveFailed"));
      return;
    }
    setAlert("success", t("creation.saved"));
    if (!entryId && data.id) {
      const next = new URL(window.location.href);
      next.searchParams.set("id", String(data.id));
      window.history.replaceState(null, "", next.toString());
    }
  } catch {
    setAlert("error", t("common.networkError"));
  } finally {
    saveBtn.disabled = false;
  }
}

saveBtn.addEventListener("click", () => {
  void saveEntry();
});

publicBtn.addEventListener("click", () => {
  isPublic = !isPublic;
  renderPublicLabel();
});

bubbleRunBtn.addEventListener("click", () => {
  void runPolish();
});

bubbleCloseBtn.addEventListener("click", () => {
  hideBubble(true);
});

bubbleApplyBtn.addEventListener("click", applyResult);

bubbleDiscardBtn.addEventListener("click", () => {
  pendingResult = "";
  bubblePreview.hidden = true;
  bubbleApplyRow.hidden = true;
  bubbleStatus.textContent = "";
});

bubble.querySelectorAll<HTMLButtonElement>(".creation-assist-preset").forEach((btn) => {
  btn.addEventListener("click", () => {
    const preset = btn.dataset.preset || "";
    const instruction = presetInstructions[preset];
    if (!instruction) {
      return;
    }
    bubbleInstruction.value = instruction;
    void runPolish(instruction);
  });
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !bubble.hidden) {
    hideBubble(true);
  }
});

async function init(): Promise<void> {
  await hydrateSiteBrand();
  await loadProfile();
  renderPublicLabel();
  await loadAssistOptions();
  await loadEntry();
}

void init();

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await logout();
  } finally {
    window.location.replace("/login.html");
  }
});
