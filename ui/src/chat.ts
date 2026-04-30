import { createLLMThread, fetchChatLLMConfigs, fetchChatMessage, fetchChats, fetchLLMThreads, fetchMessages, fetchSharedMarkdown, retryMessage, revokeMessage as revokeChatMessage, sendAttachment, sendMessage, startChat, switchLLMThreadConfig, updateLLMThread } from "./api/chat.js";
import { fetchBotUsers } from "./api/dashboard.js";
import { requestJson } from "./api/http.js";
import { fetchCurrentUser, logout } from "./api/session.js";
import { resolveAvatar } from "./lib/avatar.js";
import { formatDeviceType } from "./lib/client.js";
import { byId } from "./lib/dom.js";
import { renderMarkdown } from "./lib/marked.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";
import type { ChatEventPayload, ChatLLMConfig, ChatMessage, ChatMessageAttachment, ChatSummary, LLMThread } from "./types/chat.js";
const chatWelcome = byId<HTMLElement>("chatWelcome");
const chatQuickStart = byId<HTMLElement>("chatQuickStart");
const chatList = byId<HTMLElement>("chatList");
const chatTitle = byId<HTMLElement>("chatTitle");
const chatSubtitle = byId<HTMLElement>("chatSubtitle");
const messageList = byId<HTMLElement>("messageList");
const messageForm = byId<HTMLFormElement>("messageForm");
const messageInput = byId<HTMLTextAreaElement>("messageInput");
const chatRefreshBtn = byId<HTMLButtonElement>("chatRefreshBtn");
const chatNewTopicBtn = byId<HTMLButtonElement>("chatNewTopicBtn");
const chatRenameTopicBtn = byId<HTMLButtonElement>("chatRenameTopicBtn");
const chatThreadBar = byId<HTMLElement>("chatThreadBar");
const chatThreadSelect = byId<HTMLSelectElement>("chatThreadSelect");
const chatModelBar = byId<HTMLElement>("chatModelBar");
const chatModelCurrent = byId<HTMLElement>("chatModelCurrent");
const chatModelSelect = byId<HTMLSelectElement>("chatModelSelect");
const chatSwitchModelBtn = byId<HTMLButtonElement>("chatSwitchModelBtn");
const attachmentBtn = byId<HTMLLabelElement>("attachmentBtn");
const attachmentInput = byId<HTMLInputElement>("attachmentInput");

let currentUserId = "";
let activeThreadId: string | null = null;
let chatCache: ChatSummary[] = [];
let pollTimer: number | null = null;
let ws: WebSocket | null = null;
let wsConnected = false;
let activeMessages: ChatMessage[] = [];
let activeMessageLoadedAt = "";
let activeLLMThreadId: number | null = null;
let activeLLMThreads: LLMThread[] = [];
let activeIsAIChat = false;
let activeIsBotChat = false;
let currentLLMConfigs: ChatLLMConfig[] = [];
let activeChatSummary: ChatSummary | null = null;
let activeChatBlocked = false;
let activeChatBlockMessage = "";
let activeChatReplyRequired = false;
let activeChatReplyRequiredMessage = "";
const expandedMarkdownMessages = new Set<string>();
const sharedMarkdownContentCache = new Map<string, string>();
const sharedMarkdownLoading = new Set<string>();
const messageCacheMap = new Map<string, ChatMessage[]>();
const MSG_PAGE_SIZE = 50;
let visibleOlderCount = 0;

// Local-only thumb feedback state, persisted in localStorage so it survives
// reloads. No backend wiring yet — this is a pure UI gesture for now (feeds
// future analytics / fine-tuning loops).
const FEEDBACK_STORAGE_KEY = "polar_chat_feedback_v1";

// Last-active thread, persisted across reloads so the page restores the chat
// the user was looking at instead of jumping to chats[0].
const ACTIVE_THREAD_STORAGE_KEY = "polar_chat_active_thread_v1";
function loadStoredActiveThread(): string | null {
  try {
    return window.localStorage.getItem(ACTIVE_THREAD_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}
function persistActiveThread(threadId: string | null): void {
  try {
    if (threadId) {
      window.localStorage.setItem(ACTIVE_THREAD_STORAGE_KEY, threadId);
    } else {
      window.localStorage.removeItem(ACTIVE_THREAD_STORAGE_KEY);
    }
  } catch {
    // localStorage may be disabled (private mode); silently degrade.
  }
}
type Feedback = { up: Set<string>; down: Set<string> };
const feedback: Feedback = loadFeedback();
function loadFeedback(): Feedback {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (!raw) return { up: new Set(), down: new Set() };
    const parsed = JSON.parse(raw) as { up?: string[]; down?: string[] };
    return { up: new Set(parsed.up || []), down: new Set(parsed.down || []) };
  } catch {
    return { up: new Set(), down: new Set() };
  }
}
function persistFeedback(): void {
  try {
    window.localStorage.setItem(
      FEEDBACK_STORAGE_KEY,
      JSON.stringify({ up: [...feedback.up], down: [...feedback.down] }),
    );
  } catch {
    // localStorage may be disabled (private mode); silently degrade.
  }
}

// Inline SVG icons. 16x16, currentColor stroke. Modeled on the Lucide /
// Tabler line-art set: light, recognizable, color-inheriting so we don't
// need light/dark variants.
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const ICON_THUMB_UP =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z"/><path d="M7 11l4-7a2 2 0 0 1 3.7 1l-1 5h5a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.3 20H7"/></svg>';
const ICON_THUMB_DOWN =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z"/><path d="M17 13l-4 7a2 2 0 0 1-3.7-1l1-5H5.3A2 2 0 0 1 3.3 11.7L4.7 4.7A2 2 0 0 1 6.7 4H17"/></svg>';
const ICON_REGENERATE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>';
const ICON_EXPAND =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const ICON_COLLAPSE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 15 12 9 18 15"/></svg>';
const ICON_SHARE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
const ICON_FAVORITE =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';

type QuickStartTarget = {
  user_id: string;
  name: string;
  meta: string;
};
type QuickStartLLMOption = {
  id: number;
  name: string;
  model: string;
};

let quickStartTargets: QuickStartTarget[] = [];
let quickStartLLMOptions: QuickStartLLMOption[] = [];

function getCacheKey(): string {
  return activeLLMThreadId != null
    ? `${activeThreadId}:${activeLLMThreadId}`
    : (activeThreadId || "");
}

function escapeHtml(input: string): string {
  return input
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#39;");
}

// shared_markdown messages carry: a title (first ~60 chars of the AI reply),
// a preview (first ~120 chars), and on expand, the full markdown which the
// backend stored as `# {title}\n\n{reply}`. All three start with the same
// text, so naive rendering shows the opening sentence three times. These
// helpers strip the redundancy.
function isPrefixOverlap(title: string, preview: string): boolean {
  const a = title.replace(/\s+/g, "").trim();
  const b = preview.replace(/\s+/g, "").trim();
  if (!a || !b) return false;
  return b.startsWith(a.slice(0, Math.min(a.length, 20)));
}

function stripLeadingHeading(markdown: string, title: string): string {
  const trimmed = markdown.replace(/^﻿/, "").trimStart();
  if (!trimmed.startsWith("#")) return markdown;
  const newlineIdx = trimmed.indexOf("\n");
  const headingLine = newlineIdx >= 0 ? trimmed.slice(0, newlineIdx) : trimmed;
  const headingText = headingLine.replace(/^#+\s*/, "").trim();
  const titleText = title.trim();
  if (!titleText) return markdown;
  if (headingText === titleText || headingText.startsWith(titleText) || titleText.startsWith(headingText)) {
    return newlineIdx >= 0 ? trimmed.slice(newlineIdx + 1).trimStart() : "";
  }
  return markdown;
}

// closeOpenFences: while a bot reply is streaming a code block, the closing
// ``` may not have arrived yet. Counting fences and appending a temporary
// closer keeps `renderMarkdown` from rendering the in-progress code as plain
// text. We only fix odd fence counts; tables / lists are left as-is.
function closeOpenFences(text: string): string {
  if (!text) return "";
  const matches = text.match(/```/g);
  if (matches && matches.length % 2 === 1) {
    return text + "\n```";
  }
  return text;
}

// buildBotActionBar renders the icon row that sits below a bot reply.
// Layout (left to right): copy, like, dislike, regenerate, [expand], [share],
// [favorite]. Bracketed entries only appear for shared_markdown messages,
// which is the only message type that has a saved Markdown doc to expand
// or share. Like/dislike track only in localStorage for now.
function buildBotActionBar(opts: {
  messageId: string;
  isFailed: boolean;
  isSharedMarkdown: boolean;
  isExpanded: boolean;
  liked: boolean;
  disliked: boolean;
}): string {
  const id = opts.messageId;
  const buttons: string[] = [];
  buttons.push(iconButton("message-copy", id, t("chat.copy"), ICON_COPY));
  buttons.push(iconButton("message-like", id, t("chat.like"), ICON_THUMB_UP, opts.liked));
  buttons.push(iconButton("message-dislike", id, t("chat.dislike"), ICON_THUMB_DOWN, opts.disliked));
  buttons.push(iconButton("message-retry", id, opts.isFailed ? t("chat.retry") : t("chat.regenerate"), ICON_REGENERATE));
  if (opts.isSharedMarkdown) {
    buttons.push(
      iconButton(
        "message-expand",
        id,
        opts.isExpanded ? t("chat.collapse") : t("chat.expand"),
        opts.isExpanded ? ICON_COLLAPSE : ICON_EXPAND,
      ),
    );
    buttons.push(iconButton("message-public-share", id, t("chat.sharePublicly"), ICON_SHARE));
    buttons.push(iconButton("message-favorite", id, t("chat.favorite"), ICON_FAVORITE));
  }
  return `<div class="message-action-bar">${buttons.join("")}</div>`;
}

function iconButton(cls: string, id: string, label: string, svg: string, active = false): string {
  const activeCls = active ? " is-active" : "";
  return `<button class="message-action-icon ${cls}${activeCls}" data-id="${id}" type="button" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${svg}</button>`;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return t("chat.fileSizeMB", { size: (bytes / (1024 * 1024)).toFixed(1) });
  }
  return t("chat.fileSizeKB", { size: String(Math.ceil(bytes / 1024)) });
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
}

function attachmentIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.startsWith("video/")) return "🎬";
  if (mimeType.startsWith("audio/")) return "🎵";
  if (mimeType.includes("pdf")) return "📄";
  if (mimeType.includes("zip") || mimeType.includes("compress")) return "🗜️";
  return "📎";
}

function renderAttachment(att: ChatMessageAttachment): string {
  const isImage = att.mime_type.startsWith("image/");
  const isVideo = att.mime_type.startsWith("video/");
  const fileUrl = escapeHtml(att.url);
  const fileName = escapeHtml(att.file_name);
  const sizeStr = escapeHtml(formatFileSize(att.size));

  if (isImage) {
    const thumbUrl = escapeHtml(att.thumbnail_url || att.url);
    return `<a href="${fileUrl}" target="_blank" rel="noopener"><img class="message-attachment-image" src="${thumbUrl}" alt="${fileName}" title="${fileName}" /></a>`;
  }

  if (isVideo) {
    return `<video class="message-attachment-image" src="${fileUrl}" controls preload="metadata"></video>`;
  }

  const icon = attachmentIcon(att.mime_type);
  return `
    <a class="message-attachment-file" href="${fileUrl}" target="_blank" rel="noopener" download="${fileName}">
      <span class="message-attachment-icon">${icon}</span>
      <div class="message-attachment-meta">
        <div class="message-attachment-name">${fileName}</div>
        <div class="message-attachment-size">${sizeStr}</div>
      </div>
    </a>
  `;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) {
    return false;
  }

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(textarea);
  }

  return copied;
}

initStoredTheme();
bindThemeSync();

function formatTime(value?: string): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleString();
}

function formatPresence(chat: ChatSummary): string {
  if (chat.other_user_online) {
    return t("chat.online", { device: formatDeviceType(chat.other_user_device_type, t) });
  }
  if (chat.other_user_last_seen_at) {
    return t("chat.offline", { time: formatTime(chat.other_user_last_seen_at) });
  }
  return t("chat.offlineDevice", { device: formatDeviceType(chat.other_user_device_type, t) });
}

function truncatePreview(input?: string, maxLength = 20): string {
  const text = (input || "").trim();
  if (!text) {
    return t("chat.noPreview");
  }
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function updateActiveChatHeader(): void {
  if (!activeThreadId && !activeChatSummary) {
    return;
  }
  const chat = chatCache.find((item) => item.id === activeThreadId) || activeChatSummary;
  if (!chat) {
    return;
  }
  activeChatSummary = chat;
  chatTitle.textContent = chat.other_username;
  chatSubtitle.textContent = activeChatBlocked && activeChatBlockMessage
    ? activeChatBlockMessage
    : activeChatReplyRequired && activeChatReplyRequiredMessage
      ? activeChatReplyRequiredMessage
    : formatPresence(chat);
}

function isAIChat(chat?: ChatSummary | null): boolean {
  if (!chat) {
    return false;
  }
  return chat.other_user_id === "system" || chat.other_user_id.startsWith("bot_");
}

function isBotChat(chat?: ChatSummary | null): boolean {
  if (!chat) {
    return false;
  }
  return chat.other_user_id.startsWith("bot_");
}

function renderLLMThreadBar(): void {
  chatThreadBar.hidden = !activeIsAIChat;
  chatNewTopicBtn.hidden = !activeIsAIChat;
  chatRenameTopicBtn.hidden = !activeIsAIChat;
  if (!activeIsAIChat) {
    chatThreadSelect.innerHTML = "";
    chatModelBar.hidden = true;
    return;
  }
  if (!activeLLMThreads.length) {
    chatThreadSelect.innerHTML = `<option value="">${t("chat.defaultTopic")}</option>`;
    chatThreadSelect.disabled = true;
    chatRenameTopicBtn.disabled = true;
    renderLLMThreadModelBar();
    return;
  }
  chatThreadSelect.disabled = false;
  chatRenameTopicBtn.disabled = !activeLLMThreadId;
  chatThreadSelect.innerHTML = activeLLMThreads
    .map((thread) => `<option value="${thread.id}">${escapeHtml(thread.title || t("chat.newTopic"))}</option>`)
    .join("");
  if (activeLLMThreadId) {
    chatThreadSelect.value = String(activeLLMThreadId);
  }
  renderLLMThreadModelBar();
}

function renderLLMThreadModelBar(): void {
  chatModelBar.hidden = !activeIsBotChat;
  if (!activeIsBotChat) {
    chatModelCurrent.textContent = t("chat.systemAssistant");
    chatModelSelect.innerHTML = "";
    chatSwitchModelBtn.disabled = true;
    return;
  }
  const activeThread = activeLLMThreads.find((thread) => thread.id === activeLLMThreadId) || null;
  if (!activeThread) {
    chatModelCurrent.textContent = t("chat.noTopicSelected");
    chatModelSelect.innerHTML = `<option value="">${t("chat.selectTopicFirst")}</option>`;
    chatSwitchModelBtn.disabled = true;
    return;
  }
  chatModelCurrent.textContent = activeThread.config_name
    ? `${activeThread.config_name}${activeThread.config_model ? ` · ${activeThread.config_model}` : ""}`
    : t("chat.followBotDefault");
  if (!currentLLMConfigs.length) {
    chatModelSelect.innerHTML = `<option value="">${t("chat.noConfigs")}</option>`;
    chatSwitchModelBtn.disabled = true;
    return;
  }
  chatModelSelect.innerHTML = currentLLMConfigs
    .map((config) => `<option value="${config.id}">${escapeHtml(config.name)} · ${escapeHtml(config.model)}</option>`)
    .join("");
  if (activeThread.llm_config_id && currentLLMConfigs.some((config) => config.id === activeThread.llm_config_id)) {
    chatModelSelect.value = String(activeThread.llm_config_id);
  } else if (currentLLMConfigs[0]) {
    chatModelSelect.value = String(currentLLMConfigs[0].id);
  }
  chatSwitchModelBtn.disabled = activeThread.llm_config_id != null && chatModelSelect.value === String(activeThread.llm_config_id);
}

function getMessageMarker(message?: ChatMessage | null): string {
  if (!message) {
    return "";
  }
  return `${message.created_at || ""}#${message.id || ""}`;
}

function updateActiveMessageLoadedAt(messages: ChatMessage[]): void {
  const latest = messages[messages.length - 1];
  activeMessageLoadedAt = getMessageMarker(latest);
}

// scheduleRenderMessages coalesces streaming-driven re-renders to ~one paint
// per animation frame. WS chunks can arrive faster than the browser's frame
// rate; without throttling we'd rebuild the entire messageList innerHTML on
// each chunk and scroll/select state would thrash. Direct user actions still
// call renderMessages() unconditionally.
let pendingRenderFrame: number | null = null;
let pendingRenderScroll = false;
function scheduleRenderMessages(scrollToBottom = true): void {
  if (scrollToBottom) {
    pendingRenderScroll = true;
  }
  if (pendingRenderFrame !== null) return;
  pendingRenderFrame = window.requestAnimationFrame(() => {
    pendingRenderFrame = null;
    const scroll = pendingRenderScroll;
    pendingRenderScroll = false;
    renderMessages(activeMessages, scroll);
  });
}

// upsertMessage replaces any existing message with the same id (used for
// streaming updates where the same message arrives multiple times with
// growing content), or appends a new one. Out-of-order chunks are dropped
// using the seq counter — incoming.seq < existing.seq means a stale event
// raced past us.
function upsertMessage(message: ChatMessage): boolean {
  if (!message) return false;
  const index = activeMessages.findIndex((item) => item.id === message.id);
  if (index === -1) {
    activeMessages = [...activeMessages, message];
    updateActiveMessageLoadedAt(activeMessages);
    return true;
  }
  const existing = activeMessages[index];
  const incomingSeq = typeof message.seq === "number" ? message.seq : 0;
  const existingSeq = typeof existing.seq === "number" ? existing.seq : 0;
  if (incomingSeq > 0 && incomingSeq < existingSeq) {
    return false;
  }
  // When a streaming row finalizes (streaming=true → false with markdown
  // attached), the WS payload swaps full content for a 120-char preview. The
  // user just watched the full text type out — collapsing it behind an
  // "expand" button feels like the UI is taking back what it just gave them.
  // Snapshot the last streamed content into the expanded cache and pre-mark
  // the message as expanded so the card opens with the streamed body intact.
  const wasStreaming = existing.streaming === true;
  const justFinalized = wasStreaming && message.streaming !== true && Boolean(message.markdown_entry_id);
  if (justFinalized) {
    const streamedBody = existing.content || "";
    if (streamedBody) {
      sharedMarkdownContentCache.set(String(message.id), streamedBody);
    }
    expandedMarkdownMessages.add(String(message.id));
  }
  const next = activeMessages.slice();
  next[index] = message;
  activeMessages = next;
  updateActiveMessageLoadedAt(activeMessages);
  return true;
}

function markMessageRevoked(messageId: string): boolean {
  const index = activeMessages.findIndex((item) => item.id === messageId);
  if (index === -1) {
    return false;
  }
  const target = activeMessages[index];
  const nextMessages = activeMessages.slice();
  nextMessages[index] = {
    ...target,
    deleted: true,
    content: target.content || "",
  };
  activeMessages = nextMessages;
  updateActiveMessageLoadedAt(activeMessages);
  return true;
}

function removeMessageIfNeeded(messageId: string): boolean {
  const nextMessages = activeMessages.filter((item) => item.id !== messageId);
  if (nextMessages.length === activeMessages.length) {
    return false;
  }
  activeMessages = nextMessages;
  updateActiveMessageLoadedAt(activeMessages);
  return true;
}

function shouldRefreshActiveMessages(threadId: string): boolean {
  const chat = chatCache.find((item) => item.id === threadId);
  if (!chat?.last_message_at) {
    return activeMessages.length === 0;
  }
  if (!activeMessageLoadedAt) {
    return true;
  }
  const [loadedAt] = activeMessageLoadedAt.split("#");
  return chat.last_message_at > loadedAt;
}

function getTargetFromQuery(): { userId: string | null; username: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    userId: params.get("user_id"),
    username: params.get("username"),
  };
}

async function loadProfile(): Promise<void> {
  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
  currentUserId = data.user_id;
  chatWelcome.textContent = t("chat.welcome", { username: data.username });
  renderSidebarFoot(data);
}

function renderChatList(chats: ChatSummary[]): void {
  chatList.innerHTML = "";
  if (!chats.length) {
    chatList.innerHTML = `<div class='chat-empty'>${t("chat.noConversations")}</div>`;
    return;
  }

  chats.forEach((chat) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "chat-item";
    if (activeThreadId === chat.id) {
      item.classList.add("active");
    }
    const unreadBadge = chat.unread_count
      ? `<span class="unread-badge">${chat.unread_count}</span>`
      : "";
    const avatar = resolveAvatar(chat.other_username, chat.other_user_icon, 48);
    item.innerHTML = `
      <div class="chat-item-header">
        <img class="avatar-xs" src="${avatar}" alt="${chat.other_username}" />
        <div class="chat-item-body">
          <div class="chat-item-title">${chat.other_username}${unreadBadge}</div>
          <div class="chat-item-meta">
            <span>${truncatePreview(chat.last_message, 20)}</span>
            <span>${chat.last_message_at ? formatTime(chat.last_message_at) : ""}</span>
          </div>
          <div class="chat-item-meta">
            <span>${formatPresence(chat)}</span>
          </div>
        </div>
      </div>
    `;
    item.addEventListener("click", () => {
      void openChat(chat);
    });
    chatList.appendChild(item);
  });
}

function buildChatListSignature(chats: ChatSummary[]): string {
  return chats
    .map((chat) =>
      [
        chat.id,
        chat.other_username,
        chat.other_user_online ? "1" : "0",
        chat.other_user_device_type || "",
        chat.other_user_last_seen_at || "",
        chat.unread_count || 0,
        chat.last_message || "",
        chat.last_message_at || "",
      ].join("|")
    )
    .join("||");
}

async function loadChats(focusThreadId: string | null = null): Promise<void> {
  const { response, data } = await fetchChats();
  if (!response.ok) {
    chatList.innerHTML = `<div class='chat-empty'>${t("chat.loadFailed")}</div>`;
    return;
  }

  const nextChats = data.chats || [];
  const previousSignature = buildChatListSignature(chatCache);
  const nextSignature = buildChatListSignature(nextChats);
  chatCache = nextChats;
  if (focusThreadId) {
    const match = chatCache.find((item) => item.id === focusThreadId);
    if (match) {
      activeThreadId = match.id;
      activeChatSummary = match;
    }
  }
  if (previousSignature !== nextSignature) {
    renderChatList(chatCache);
  }
  updateActiveChatHeader();
}

async function startChatWithUser(userId: string, llmConfigId?: number | null): Promise<ChatSummary | null> {
  const { response, data } = await startChat(userId, llmConfigId);
  if (!response.ok) {
    chatSubtitle.textContent = data.error || t("chat.createFailed");
    return null;
  }
  return data.chat || null;
}

function renderQuickStart(targets: QuickStartTarget[], llmOptions: QuickStartLLMOption[]): void {
  if (!targets.length) {
    chatQuickStart.innerHTML = `<div class="chat-empty">暂无可用 Bot。请先创建或检查 LLM 配置。</div>`;
    return;
  }

  const botOptionsHTML = targets
    .map((item) => `<option value="${escapeHtml(item.user_id)}">${escapeHtml(item.name)} · ${escapeHtml(item.meta)}</option>`)
    .join("");
  const llmOptionsHTML = [
    `<option value="">自动选择（不选也能开始）</option>`,
    ...llmOptions.map((item) => `<option value="${item.id}">${escapeHtml(item.name)} · ${escapeHtml(item.model)}</option>`),
  ].join("");
  const canStart = llmOptions.length > 0;
  chatQuickStart.innerHTML = `
    <div class="chat-quick-start-title">新建对话</div>
    <div class="chat-quick-start-list" style="display:grid; gap:8px;">
      <select id="quickStartBotSelect" class="input">${botOptionsHTML}</select>
      <select id="quickStartLLMSelect" class="input">${llmOptionsHTML}</select>
      <button id="quickStartStartBtn" class="btn-chip" type="button" ${canStart ? "" : "disabled"}>
        ${canStart ? "开始聊天" : "暂无可用 LLM，无法开始"}
      </button>
    </div>
  `;
}

async function loadQuickStartTargets(): Promise<void> {
  const targets: QuickStartTarget[] = [];
  const llmOptions: QuickStartLLMOption[] = [];
  try {
    const [botResult, llmResult] = await Promise.all([fetchBotUsers(), fetchChatLLMConfigs()]);
    if (botResult.response.ok) {
      (botResult.data.bots || []).forEach((bot) => {
        if (!bot.bot_user_id) return;
        targets.push({
          user_id: bot.bot_user_id,
          name: bot.name || bot.bot_user_id,
          meta: "Bot",
        });
      });
    }
    if (llmResult.response.ok) {
      (llmResult.data.configs || []).forEach((item) => {
        llmOptions.push({
          id: item.id,
          name: item.name,
          model: item.model,
        });
      });
    }
  } catch {
    // Keep empty state if network request fails.
  }
  quickStartTargets = targets;
  quickStartLLMOptions = llmOptions;
  renderQuickStart(quickStartTargets, quickStartLLMOptions);
}

async function loadLLMThreads(threadId: string, preferredThreadId?: number | null): Promise<void> {
  const chat = chatCache.find((item) => item.id === threadId);
  activeIsAIChat = isAIChat(chat);
  activeIsBotChat = isBotChat(chat);
  if (!activeIsAIChat) {
    activeLLMThreadId = null;
    activeLLMThreads = [];
    currentLLMConfigs = [];
    renderLLMThreadBar();
    return;
  }

  const { response, data } = await fetchLLMThreads(threadId, preferredThreadId || activeLLMThreadId);
  if (!response.ok) {
    activeLLMThreads = [];
    activeLLMThreadId = null;
    chatSubtitle.textContent = data.error || t("chat.topicsLoadFailed");
    renderLLMThreadBar();
    return;
  }

  activeLLMThreads = data.threads || [];
  activeLLMThreadId = data.active_thread?.id || preferredThreadId || activeLLMThreads[0]?.id || null;
  renderLLMThreadBar();
}

async function loadChatLLMConfigs(): Promise<void> {
  if (!activeIsBotChat) {
    currentLLMConfigs = [];
    renderLLMThreadModelBar();
    return;
  }
  const { response, data } = await fetchChatLLMConfigs();
  if (!response.ok) {
    currentLLMConfigs = [];
    chatSubtitle.textContent = data.error || t("chat.modelConfigLoadFailed");
    renderLLMThreadModelBar();
    return;
  }
  currentLLMConfigs = data.configs || [];
  renderLLMThreadModelBar();
}

function renderMessages(messages: ChatMessage[], scrollToBottom = false): void {
  activeMessages = messages;
  updateActiveMessageLoadedAt(messages);
  const cacheKey = getCacheKey();
  if (cacheKey) messageCacheMap.set(cacheKey, messages);
  if (!messages.length) {
    messageList.innerHTML = `<div class='chat-empty'>${t("chat.noMessages")}</div>`;
    return;
  }

  const visibleStart = Math.max(0, messages.length - MSG_PAGE_SIZE - visibleOlderCount);
  const visibleMessages = messages.slice(visibleStart);
  const loadOlderHtml = visibleStart > 0
    ? `<div class="message-load-older"><button class="btn-inline btn-secondary" id="msgLoadOlderBtn" type="button">↑ Load older messages (${visibleStart} more)</button></div>`
    : "";
  const prevScrollHeight = messageList.scrollHeight;
  const prevScrollTop = messageList.scrollTop;

  messageList.innerHTML = loadOlderHtml + visibleMessages
    .map((msg) => {
      const isMine = msg.sender_id === currentUserId;
      const isSystem = msg.sender_id === "system";
      const isBotReply = !isMine && (msg.sender_id === "system" || msg.sender_id.startsWith("bot_"));
      const isFailedBotReply = isBotReply && Boolean(msg.failed) && !msg.deleted;
      const isStreamingBot = Boolean(msg.streaming) && !msg.deleted;
      const isSharedMarkdown = msg.message_type === "shared_markdown" && Boolean(msg.markdown_entry_id) && !isStreamingBot;
      const isExpanded = expandedMarkdownMessages.has(String(msg.id));
      const expandedContent = sharedMarkdownContentCache.get(String(msg.id)) || "";
      const isLoadingExpanded = sharedMarkdownLoading.has(String(msg.id));
      const failureBadge = isFailedBotReply
        ? `<div class="message-failure-badge">${t("chat.sendFailed")}</div>`
        : "";
      // Bot reply icon action bar (ChatGPT-style). Renders below the bubble.
      // Hidden during streaming so the in-flight bubble stays uncluttered.
      const showBotActions = isBotReply && !msg.deleted && !isStreamingBot;
      const liked = feedback.up.has(String(msg.id));
      const disliked = feedback.down.has(String(msg.id));
      const botActionBar = showBotActions
        ? buildBotActionBar({
            messageId: String(msg.id),
            isFailed: isFailedBotReply,
            isSharedMarkdown,
            isExpanded,
            liked,
            disliked,
          })
        : "";
      const isAttachment = msg.message_type === "attachment" && Boolean(msg.attachment);
      const content = msg.deleted
        ? t("chat.messageRevoked")
        : isAttachment && msg.attachment
          ? renderAttachment(msg.attachment)
        : isStreamingBot
          ? `<div class="message-markdown-streaming markdown-body">${renderMarkdown(closeOpenFences(msg.content || ""))}</div>`
        : isSharedMarkdown
          ? (() => {
              const title = msg.markdown_title || t("chat.aiMarkdownReply");
              const preview = msg.content || "";
              const titleHtml = isPrefixOverlap(title, preview)
                ? ""
                : `<div class="message-markdown-title">${escapeHtml(title)}</div>`;
              const expandedMarkdown = isExpanded
                ? (isLoadingExpanded
                    ? t("chat.loadingContent")
                    : renderMarkdown(stripLeadingHeading(expandedContent, msg.markdown_title || "")))
                : "";
              // When the card is expanded the full body is already visible —
              // showing the 120-char preview again is just visual noise.
              const previewHtml = isExpanded
                ? ""
                : `<div class="message-markdown-preview">${escapeHtml(preview)}</div>`;
              return `
                <div class="message-markdown-card">
                  ${titleHtml}
                  ${previewHtml}
                  ${isExpanded ? `<div class="message-markdown-expanded markdown-body">${expandedMarkdown}</div>` : ""}
                </div>
              `;
            })()
        : isSystem
          ? renderMarkdown(msg.content || "")
          : escapeHtml(msg.content || "");
      const bubbleClass = msg.deleted
        ? "message-bubble deleted"
        : isStreamingBot
          ? "message-bubble streaming"
          : "message-bubble";
      const contentClass = isSharedMarkdown || isStreamingBot
        ? "message-bubble-content"
        : isSystem && !msg.deleted
          ? "message-bubble-content markdown-body"
          : "message-bubble-content";
      const revokeButton =
        isMine && !msg.deleted
          ? `<button class="message-revoke" data-id="${msg.id}" type="button">${t("chat.revoke")}</button>`
          : "";
      const avatar = resolveAvatar(msg.sender_username, msg.sender_icon, 48);
      const activeThread = activeLLMThreads.find((thread) => thread.id === (msg.llm_thread_id || activeLLMThreadId)) || null;
      const botModelMeta = isBotReply
        ? (activeThread?.config_model || activeThread?.config_name || "LLM")
        : "";
      // Hide latency until the stream completes; show "streaming…" instead.
      const latencyMeta = isBotReply && !isStreamingBot && typeof msg.latency_ms === "number" && msg.latency_ms > 0
        ? ` · ${formatLatency(msg.latency_ms)}`
        : "";
      const streamingMeta = isStreamingBot
        ? ` · <span class="message-meta-streaming">${t("chat.streaming") || "streaming"}<span class="message-streaming-dots"></span></span>`
        : "";
      const messageMeta = isBotReply
        ? `${msg.sender_username} · ${botModelMeta} · ${formatTime(msg.created_at)}${latencyMeta}${streamingMeta}${isFailedBotReply ? ` · ${t("chat.failed")}` : ""}`
        : `${msg.sender_username} · ${formatTime(msg.created_at)}`;
      if (isMine) {
        return `
          <div class="message-item mine">
            <div class="message-head">
              <img class="avatar-xs" src="${avatar}" alt="${msg.sender_username}" />
              <div class="message-meta">${messageMeta}</div>
            </div>
            <div class="message-row">
              <div class="${bubbleClass}"><div class="${contentClass}">${content}</div>${failureBadge}</div>
              ${revokeButton}
            </div>
          </div>
        `;
      }
      return `
        <div class="message-item other">
          <img class="avatar-xs message-avatar" src="${avatar}" alt="${msg.sender_username}" />
          <div class="message-body">
            <div class="message-meta">${messageMeta}</div>
            <div class="message-row">
              <div class="${bubbleClass}"><div class="${contentClass}">${content}</div>${failureBadge}</div>
              ${revokeButton}
            </div>
            ${botActionBar}
          </div>
        </div>
      `;
    })
    .join("");

  (document.getElementById("msgLoadOlderBtn") as HTMLButtonElement | null)?.addEventListener("click", () => {
    visibleOlderCount += MSG_PAGE_SIZE;
    renderMessages(activeMessages, false);
  });

  messageList.querySelectorAll<HTMLButtonElement>(".message-revoke").forEach((button) => {
    button.addEventListener("click", async () => {
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }
      await revokeMessage(messageId);
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-retry").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeThreadId) {
        return;
      }
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }
      // Only failed bot replies are torn down locally on click. For a
      // successful reply this button means "regenerate" — the original stays
      // and a new bubble streams in alongside it via WS.
      const target = activeMessages.find((m) => m.id === messageId);
      const isFailedSource = Boolean(target?.failed);
      button.disabled = true;
      chatSubtitle.textContent = t("chat.retrying");
      try {
        const { response, data } = await retryMessage(activeThreadId, messageId);
        if (!response.ok) {
          chatSubtitle.textContent = data.error || t("chat.retryFailed");
          return;
        }
        if (isFailedSource && removeMessageIfNeeded(messageId)) {
          renderMessages(activeMessages);
        }
        chatSubtitle.textContent = data.message || t("chat.retrySuccess");
      } finally {
        button.disabled = false;
      }
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-like").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id) return;
      if (feedback.up.has(id)) {
        feedback.up.delete(id);
      } else {
        feedback.up.add(id);
        feedback.down.delete(id);
      }
      persistFeedback();
      button.classList.toggle("is-active", feedback.up.has(id));
      const dislikeButton = messageList.querySelector<HTMLButtonElement>(`.message-dislike[data-id="${id}"]`);
      dislikeButton?.classList.remove("is-active");
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-dislike").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.id;
      if (!id) return;
      if (feedback.down.has(id)) {
        feedback.down.delete(id);
      } else {
        feedback.down.add(id);
        feedback.up.delete(id);
      }
      persistFeedback();
      button.classList.toggle("is-active", feedback.down.has(id));
      const likeButton = messageList.querySelector<HTMLButtonElement>(`.message-like[data-id="${id}"]`);
      likeButton?.classList.remove("is-active");
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-copy").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeThreadId) {
        return;
      }
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }
      const { response, data } = await fetchSharedMarkdown(activeThreadId, messageId);
      if (!response.ok || !data.content) {
        return;
      }
      try {
        const copied = await copyTextToClipboard(data.content);
        if (!copied) {
          chatSubtitle.textContent = t("chat.copyFailed");
          return;
        }
        chatSubtitle.textContent = t("chat.copySuccess");
      } catch {
        chatSubtitle.textContent = t("chat.copyPermissionFailed");
      }
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-expand").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeThreadId) {
        return;
      }
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }

      if (expandedMarkdownMessages.has(messageId)) {
        expandedMarkdownMessages.delete(messageId);
        renderMessages(activeMessages);
        return;
      }

      expandedMarkdownMessages.add(messageId);
      if (sharedMarkdownContentCache.has(messageId)) {
        renderMessages(activeMessages);
        return;
      }

      sharedMarkdownLoading.add(messageId);
      renderMessages(activeMessages);
      const { response, data } = await fetchSharedMarkdown(activeThreadId, messageId);
      sharedMarkdownLoading.delete(messageId);
      if (!response.ok || !data.content) {
        expandedMarkdownMessages.delete(messageId);
        chatSubtitle.textContent = data?.error || t("chat.markdownLoadFailed");
        renderMessages(activeMessages);
        return;
      }
      sharedMarkdownContentCache.set(messageId, data.content);
      renderMessages(activeMessages);
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-public-share").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeThreadId) {
        return;
      }
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }
      const { response, data } = await fetchSharedMarkdown(activeThreadId, messageId);
      if (!response.ok || !data.content) {
        return;
      }
      const shareResult = await requestJson<{ id?: number; error?: string }>("/api/markdown", {
        method: "POST",
        body: {
          title: data.entry?.title || t("chat.aiMarkdownReply"),
          content: data.content,
          is_public: true,
        },
      });
      if (!shareResult.response.ok || !shareResult.data.id) {
        chatSubtitle.textContent = shareResult.data.error || t("chat.shareFailed");
        return;
      }
      chatSubtitle.textContent = t("chat.shareSuccess");
      window.open(`/markdown.html?id=${encodeURIComponent(String(shareResult.data.id))}`, "_blank");
    });
  });
  messageList.querySelectorAll<HTMLButtonElement>(".message-favorite").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!activeThreadId) {
        return;
      }
      const messageId = button.dataset.id;
      if (!messageId) {
        return;
      }
      const { response, data } = await fetchSharedMarkdown(activeThreadId, messageId);
      if (!response.ok || !data.content) {
        return;
      }
      const saveResult = await requestJson<{ id?: number; error?: string }>("/api/markdown", {
        method: "POST",
        body: {
          title: data.entry?.title || t("chat.aiMarkdownReply"),
          content: data.content,
          is_public: false,
        },
      });
      if (!saveResult.response.ok || !saveResult.data.id) {
        chatSubtitle.textContent = saveResult.data.error || t("chat.favoriteFailed");
        return;
      }
      chatSubtitle.textContent = t("chat.favoriteSuccess");
      window.open(`/editor.html?id=${encodeURIComponent(String(saveResult.data.id))}`, "_blank");
    });
  });
  if (scrollToBottom) {
    messageList.scrollTop = messageList.scrollHeight;
  } else {
    messageList.scrollTop = prevScrollTop + (messageList.scrollHeight - prevScrollHeight);
  }
}

async function loadMessages(threadId: string): Promise<void> {
  const cacheKey = getCacheKey();
  const cached = messageCacheMap.get(cacheKey);
  if (cached?.length) {
    visibleOlderCount = 0;
    renderMessages(cached, true);
  } else {
    messageList.innerHTML = `<div class='chat-empty'>${t("chat.loading")}</div>`;
  }
  const { response, data } = await fetchMessages(threadId, 200, activeLLMThreadId);
  if (!response.ok) {
    if (!cached?.length) {
      messageList.innerHTML = `<div class='chat-empty'>${t("chat.loadFailed")}</div>`;
    }
    return;
  }
  activeChatBlocked = Boolean(data.blocked);
  activeChatBlockMessage = data.block_message || "";
  activeChatReplyRequired = Boolean(data.reply_required);
  activeChatReplyRequiredMessage = data.reply_required_message || "";
  const inputDisabled = activeChatBlocked || activeChatReplyRequired;
  messageInput.disabled = inputDisabled;
  attachmentBtn.classList.toggle("uploading", inputDisabled);
  updateActiveChatHeader();
  if (data.active_thread?.id) {
    activeLLMThreadId = data.active_thread.id;
    if (!activeLLMThreads.some((thread) => thread.id === data.active_thread?.id) && data.active_thread) {
      activeLLMThreads = [data.active_thread, ...activeLLMThreads];
    }
    renderLLMThreadBar();
  }
  renderMessages(data.messages || [], true);
  reconcileStaleStreamingMessages(threadId, data.messages || []);
}

// Reload-recovery: a streaming row whose updated_at is older than 5s likely
// finalized while the page was reloading and the WS handler missed the final
// event. Re-fetch each such message once and upsert it. Bounded to a few
// fetches per thread; cheap insurance.
async function reconcileStaleStreamingMessages(threadId: string, messages: ChatMessage[]): Promise<void> {
  const now = Date.now();
  const stale = messages.filter((msg) => {
    if (!msg.streaming) return false;
    if (!msg.updated_at) return true;
    return now - new Date(msg.updated_at).getTime() > 5000;
  });
  if (!stale.length) return;
  await Promise.all(
    stale.map(async (msg) => {
      try {
        const { response, data } = await fetchChatMessage(threadId, msg.id);
        if (!response.ok || !data.message) return;
        if (activeThreadId !== threadId) return;
        if (upsertMessage(data.message)) {
          scheduleRenderMessages();
        }
      } catch {
        // network blip — WS will catch up.
      }
    }),
  );
}

function hasActiveStreamingMessage(): boolean {
  return activeMessages.some((msg) => msg.streaming === true && !msg.deleted);
}

async function refreshActiveMessagesIfNeeded(threadId: string, force = false): Promise<void> {
  // While a row is mid-stream, chat_threads.last_message_at hasn't changed,
  // so the normal staleness check returns false. Force refresh so polling
  // (when WS is down) still pulls the growing content.
  if (force || hasActiveStreamingMessage() || shouldRefreshActiveMessages(threadId)) {
    await loadMessages(threadId);
  }
}

async function openChat(chat: ChatSummary): Promise<void> {
  const previousThreadId = activeThreadId;
  activeThreadId = chat.id;
  persistActiveThread(chat.id);
  activeChatSummary = chat;
  activeChatBlocked = false;
  activeChatBlockMessage = "";
  activeChatReplyRequired = false;
  activeChatReplyRequiredMessage = "";
  activeMessageLoadedAt = "";
  activeLLMThreadId = null;
  visibleOlderCount = 0;
  updateActiveChatHeader();
  messageInput.disabled = false;
  renderChatList(chatCache);
  if (previousThreadId && previousThreadId !== chat.id) {
    sendPresence("leave_thread", previousThreadId);
  }
  await loadLLMThreads(chat.id);
  await loadChatLLMConfigs();
  await loadMessages(chat.id);
  await loadChats(chat.id);
  sendPresence("view_thread", chat.id);
}

async function revokeMessage(messageId: string): Promise<void> {
  if (!activeThreadId) {
    return;
  }
  const response = await revokeChatMessage(activeThreadId, messageId);
  if (!response.ok) {
    return;
  }
  if (!markMessageRevoked(messageId)) {
    await loadMessages(activeThreadId);
  } else {
    renderMessages(activeMessages);
  }
  await loadChats(activeThreadId);
}

function startPolling(): void {
  if (wsConnected) {
    return;
  }
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }
  // Poll faster (1s) when a streaming bubble is active so the user sees
  // growing content even if WS is down; otherwise the standard 5s cadence.
  const interval = hasActiveStreamingMessage() ? 1000 : 5000;
  pollTimer = window.setInterval(async () => {
    await loadChats(activeThreadId);
    if (activeThreadId) {
      await refreshActiveMessagesIfNeeded(activeThreadId);
    }
    // Re-tune cadence as streaming starts/stops without reconnecting WS.
    const desired = hasActiveStreamingMessage() ? 1000 : 5000;
    if (desired !== interval) {
      stopPolling();
      startPolling();
    }
    // Try to reconnect WS opportunistically; if a network blip dropped it
    // mid-stream, polling keeps the UI alive and this brings real-time back.
    if (!wsConnected && (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING)) {
      connectWebSocket();
    }
  }, interval);
}

function stopPolling(): void {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

function getWebSocketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/chat`;
}

function sendPresence(action: "view_thread" | "leave_thread", threadId?: string | null): void {
  if (!wsConnected || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  const parsedThreadId = Number(threadId || 0);
  if (action === "view_thread" && parsedThreadId <= 0) {
    return;
  }
  ws.send(JSON.stringify({
    type: "presence",
    action,
    thread_id: parsedThreadId > 0 ? parsedThreadId : undefined,
  }));
}

function connectWebSocket(): void {
  try {
    ws = new WebSocket(getWebSocketUrl());
  } catch {
    startPolling();
    return;
  }

  ws.addEventListener("open", () => {
    wsConnected = true;
    stopPolling();
    if (activeThreadId) {
      sendPresence("view_thread", activeThreadId);
    }
  });

  ws.addEventListener("close", () => {
    wsConnected = false;
    startPolling();
  });

  ws.addEventListener("error", () => {
    wsConnected = false;
    startPolling();
  });

  ws.addEventListener("message", async (event) => {
    let payload: ChatEventPayload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (!payload?.type) {
      return;
    }

    const chatId = payload.chat_id;
    if (payload.type === "message") {
      if (activeThreadId === chatId && chatId && payload.message) {
        const incomingLLMThreadId = payload.message.llm_thread_id || null;
        if ((!activeLLMThreadId && !incomingLLMThreadId) || activeLLMThreadId === incomingLLMThreadId) {
          if (upsertMessage(payload.message)) {
            scheduleRenderMessages();
          }
        } else if (activeIsAIChat) {
          await loadLLMThreads(chatId, activeLLMThreadId);
        }
        if (payload.message.llm_thread_id && !activeLLMThreads.some((thread) => thread.id === payload.message?.llm_thread_id)) {
          await loadLLMThreads(chatId, activeLLMThreadId);
        }
      }
      await loadChats(activeThreadId);
      return;
    }

    if (payload.type === "read") {
      await loadChats(activeThreadId);
      return;
    }

    if (payload.type === "presence") {
      await loadChats(activeThreadId);
      return;
    }

    if (payload.type === "revoke") {
      if (activeThreadId === chatId && chatId && payload.message_id) {
        const handled = payload.user_id === "retry"
          ? removeMessageIfNeeded(payload.message_id)
          : markMessageRevoked(payload.message_id);
        if (handled) {
          renderMessages(activeMessages);
        } else {
          await loadMessages(chatId);
        }
      }
      await loadChats(activeThreadId);
    }
  });
}

// Auto-resize the textarea between 1 and ~6 lines as the user types.
const MESSAGE_INPUT_MAX_HEIGHT = 168; // ~6 lines at 24px line-height
function autoResizeMessageInput(): void {
  messageInput.style.height = "auto";
  const next = Math.min(messageInput.scrollHeight, MESSAGE_INPUT_MAX_HEIGHT);
  messageInput.style.height = `${next}px`;
  messageInput.style.overflowY = messageInput.scrollHeight > MESSAGE_INPUT_MAX_HEIGHT ? "auto" : "hidden";
}
messageInput.addEventListener("input", autoResizeMessageInput);

// Enter sends, Shift+Enter inserts a newline. IME composition is left alone
// so picking a candidate doesn't accidentally submit the half-typed message.
messageInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  if (typeof messageForm.requestSubmit === "function") {
    messageForm.requestSubmit();
  } else {
    messageForm.dispatchEvent(new Event("submit", { cancelable: true }));
  }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!activeThreadId) {
    return;
  }

  const content = messageInput.value.trim();
  if (!content) {
    return;
  }

  const { response, data } = await sendMessage(activeThreadId, content, activeLLMThreadId);
  if (!response.ok) {
    chatSubtitle.textContent = data.error || "发送失败";
    if (data.code === "chat blocked") {
      activeChatBlocked = true;
      activeChatBlockMessage = data.error || "";
      messageInput.disabled = true;
    } else if (data.code === "chat reply required") {
      activeChatReplyRequired = Boolean(data.reply_required);
      activeChatReplyRequiredMessage = data.reply_required_message || data.error || "";
      messageInput.disabled = true;
    }
    return;
  }

  messageInput.value = "";
  autoResizeMessageInput();
  activeChatReplyRequired = Boolean(data.reply_required);
  activeChatReplyRequiredMessage = data.reply_required_message || "";
  messageInput.disabled = activeChatBlocked || activeChatReplyRequired;
  updateActiveChatHeader();
  if (!wsConnected) {
    await loadMessages(activeThreadId);
  }
  await loadChats(activeThreadId);
});

attachmentInput.addEventListener("change", async () => {
  const file = attachmentInput.files?.[0];
  if (!file || !activeThreadId) {
    attachmentInput.value = "";
    return;
  }
  attachmentBtn.classList.add("uploading");
  chatSubtitle.textContent = t("chat.uploading");
  try {
    const { response, data } = await sendAttachment(activeThreadId, file);
    if (!response.ok) {
      chatSubtitle.textContent = data.error || t("chat.attachmentFailed");
      if (data.code === "chat blocked") {
        activeChatBlocked = true;
        activeChatBlockMessage = data.error || "";
        messageInput.disabled = true;
      } else if (data.code === "chat reply required") {
        activeChatReplyRequired = Boolean(data.reply_required);
        activeChatReplyRequiredMessage = data.reply_required_message || data.error || "";
        messageInput.disabled = true;
      }
      return;
    }
    activeChatReplyRequired = Boolean(data.reply_required);
    activeChatReplyRequiredMessage = data.reply_required_message || "";
    messageInput.disabled = activeChatBlocked || activeChatReplyRequired;
    updateActiveChatHeader();
    if (!wsConnected) {
      await loadMessages(activeThreadId);
    }
    await loadChats(activeThreadId);
  } finally {
    attachmentInput.value = "";
    attachmentBtn.classList.remove("uploading");
  }
});

chatRefreshBtn.addEventListener("click", async () => {
  await loadChats(activeThreadId);
  if (activeThreadId) {
    await loadLLMThreads(activeThreadId, activeLLMThreadId);
    await refreshActiveMessagesIfNeeded(activeThreadId, true);
  }
});

chatQuickStart.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>("#quickStartStartBtn");
  if (!button) {
    return;
  }
  const botSelect = document.getElementById("quickStartBotSelect") as HTMLSelectElement | null;
  const llmSelect = document.getElementById("quickStartLLMSelect") as HTMLSelectElement | null;
  const userId = (botSelect?.value || "").trim();
  if (!userId) {
    chatSubtitle.textContent = "请先选择一个 Bot";
    return;
  }
  const llmConfigId = Number(llmSelect?.value || 0);
  button.disabled = true;
  try {
    const chat = await startChatWithUser(userId, llmConfigId > 0 ? llmConfigId : null);
    await loadChats(chat ? chat.id : null);
    if (chat) {
      await openChat(chat);
    }
  } finally {
    button.disabled = false;
  }
});

chatThreadSelect.addEventListener("change", async () => {
  if (!activeThreadId) {
    return;
  }
  const nextID = Number(chatThreadSelect.value || 0);
  activeLLMThreadId = nextID > 0 ? nextID : null;
  renderLLMThreadModelBar();
  activeMessageLoadedAt = "";
  visibleOlderCount = 0;
  messageCacheMap.delete(getCacheKey());
  await loadMessages(activeThreadId);
});

chatNewTopicBtn.addEventListener("click", async () => {
  if (!activeThreadId) {
    return;
  }
  const result = await createLLMThread(activeThreadId, "");
  if (!result.response.ok) {
    chatSubtitle.textContent = result.data.error || t("chat.createTopicFailed");
    return;
  }
  activeLLMThreads = result.data.threads || activeLLMThreads;
  activeLLMThreadId = result.data.thread?.id || activeLLMThreads[0]?.id || null;
  activeMessages = [];
  activeMessageLoadedAt = "";
  renderLLMThreadBar();
  renderMessages([]);
  if (activeThreadId) {
    await loadMessages(activeThreadId);
  }
});

chatRenameTopicBtn.addEventListener("click", async () => {
  if (!activeThreadId || !activeLLMThreadId) {
    return;
  }
  const currentThread = activeLLMThreads.find((thread) => thread.id === activeLLMThreadId);
  const nextTitle = window.prompt(t("chat.renameTopicPrompt"), currentThread?.title || t("chat.newTopic"));
  if (nextTitle == null) {
    return;
  }
  const trimmed = nextTitle.trim();
  if (!trimmed) {
    chatSubtitle.textContent = t("chat.topicTitleEmpty");
    return;
  }
  const result = await updateLLMThread(activeThreadId, activeLLMThreadId, trimmed);
  if (!result.response.ok) {
    chatSubtitle.textContent = result.data.error || t("chat.renameFailed");
    return;
  }
  activeLLMThreads = result.data.threads || activeLLMThreads;
  renderLLMThreadBar();
  chatSubtitle.textContent = result.data.message || t("chat.renameSuccess");
});

chatModelSelect.addEventListener("change", () => {
  const currentThread = activeLLMThreads.find((thread) => thread.id === activeLLMThreadId) || null;
  chatSwitchModelBtn.disabled = !currentThread || (currentThread.llm_config_id != null && chatModelSelect.value === String(currentThread.llm_config_id));
});

chatSwitchModelBtn.addEventListener("click", async () => {
  if (!activeThreadId || !activeLLMThreadId) {
    return;
  }
  const llmConfigId = Number(chatModelSelect.value || 0);
  if (llmConfigId <= 0) {
    chatSubtitle.textContent = t("chat.selectModelFirst");
    return;
  }
  const result = await switchLLMThreadConfig(activeThreadId, activeLLMThreadId, llmConfigId);
  if (!result.response.ok) {
    chatSubtitle.textContent = result.data.error || t("chat.switchModelFailed");
    return;
  }
  activeLLMThreads = result.data.threads || activeLLMThreads;
  renderLLMThreadBar();
  chatSubtitle.textContent = result.data.message || t("chat.switchModelSuccess");
});

async function init(): Promise<void> {
  await hydrateSiteBrand();
  await loadProfile();
  await loadQuickStartTargets();
  messageInput.disabled = true;
  connectWebSocket();

  const target = getTargetFromQuery();
  if (target.userId) {
    if (target.userId === currentUserId) {
      chatSubtitle.textContent = t("chat.cannotChatWithSelf");
      await loadChats();
      startPolling();
      return;
    }
    activeChatSummary = {
      id: "",
      other_user_id: target.userId,
      other_username: target.username || target.userId,
      other_user_online: false,
      other_user_device_type: "",
    };
    chatTitle.textContent = activeChatSummary.other_username;
    chatSubtitle.textContent = t("chat.loading");
    const chat = await startChatWithUser(target.userId);
    await loadChats(chat ? chat.id : null);
    if (chat) {
      await openChat(chat);
    }
    startPolling();
    return;
  }

  await loadChats();
  // Restore the last-viewed thread so a page reload doesn't jump to chats[0].
  const storedThreadId = loadStoredActiveThread();
  if (storedThreadId) {
    const remembered = chatCache.find((item) => item.id === storedThreadId);
    if (remembered) {
      await openChat(remembered);
    } else {
      // Stored thread no longer exists (deleted/permission revoked). Clear it
      // so we don't keep retrying.
      persistActiveThread(null);
    }
  }
  startPolling();
}

void init();

window.addEventListener("beforeunload", () => {
  if (activeThreadId) {
    sendPresence("leave_thread", activeThreadId);
  }
});

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  persistActiveThread(null);
  try { await logout(); } finally { window.location.replace("/login.html"); }
});
