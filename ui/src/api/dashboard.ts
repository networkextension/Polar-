import { request, requestJson } from "./http.js";
import type {
  BotListResponse,
  BotPayload,
  MarkdownAssistResponse,
  EntryDetailResponse,
  EntryListResponse,
  ErrorResponse,
  IconUploadResponse,
  LLMConfigListResponse,
  LLMConfigPayload,
  LoginHistoryResponse,
  PackTunnelProfileListResponse,
  PackTunnelProfilePayload,
  PackTunnelRuleResponse,
  PasskeyBeginResponse,
  PasskeyListResponse,
  SiteSettings,
  SiteSettingsResponse,
  TagListResponse,
  TagPayload,
  LatchProxyListResponse,
  LatchRuleListResponse,
  LatchProfileListResponse,
} from "../types/dashboard.js";

export async function fetchLoginHistory(limit = 5) {
  return requestJson<LoginHistoryResponse>(`/api/login-history?limit=${limit}`);
}

export async function fetchEntries(offset: number, limit = 10) {
  return requestJson<EntryListResponse>(`/api/markdown?limit=${limit}&offset=${offset}`);
}

export async function fetchEntry(id: number) {
  return requestJson<EntryDetailResponse>(`/api/markdown/${id}`);
}

export async function createTag(payload: TagPayload) {
  return requestJson<ErrorResponse>("/api/tags", {
    method: "POST",
    body: payload,
  });
}

export async function fetchTags(limit = 100, offset = 0) {
  return requestJson<TagListResponse>(`/api/tags?limit=${limit}&offset=${offset}`);
}

export async function updateTag(id: number, payload: TagPayload) {
  return requestJson<ErrorResponse>(`/api/tags/${id}`, {
    method: "PUT",
    body: payload,
  });
}

export async function removeTag(id: number) {
  return requestJson<ErrorResponse>(`/api/tags/${id}`, {
    method: "DELETE",
  });
}

export async function fetchSiteSettings() {
  return requestJson<SiteSettingsResponse>("/api/site-settings");
}

export async function fetchLLMConfigs() {
  return requestJson<LLMConfigListResponse>("/api/llm-configs");
}

export async function fetchAvailableLLMConfigs() {
  return requestJson<LLMConfigListResponse>("/api/llm-configs/available");
}

export async function createLLMConfig(payload: LLMConfigPayload) {
  return requestJson<LLMConfigListResponse>("/api/llm-configs", {
    method: "POST",
    body: payload,
  });
}

export async function testLLMConfig(payload: LLMConfigPayload) {
  return requestJson<ErrorResponse>("/api/llm-configs/test", {
    method: "POST",
    body: payload,
  });
}

export async function updateLLMConfig(
  id: number,
  payload: LLMConfigPayload & {
    update_api_key?: boolean;
  }
) {
  return requestJson<LLMConfigListResponse>(`/api/llm-configs/${id}`, {
    method: "PUT",
    body: payload,
  });
}

export async function removeLLMConfig(id: number) {
  return requestJson<ErrorResponse>(`/api/llm-configs/${id}`, {
    method: "DELETE",
  });
}

export async function fetchBotUsers() {
  return requestJson<BotListResponse>("/api/bots");
}

export async function createBotUser(payload: BotPayload) {
  return requestJson<BotListResponse>("/api/bots", {
    method: "POST",
    body: payload,
  });
}

export async function updateBotUser(id: number, payload: BotPayload) {
  return requestJson<BotListResponse>(`/api/bots/${id}`, {
    method: "PUT",
    body: payload,
  });
}

export async function removeBotUser(id: number) {
  return requestJson<ErrorResponse>(`/api/bots/${id}`, {
    method: "DELETE",
  });
}

export async function assistMarkdownWithBot(payload: {
  bot_id: number;
  llm_config_id?: number;
  title?: string;
  content: string;
  instruction?: string;
}) {
  return requestJson<MarkdownAssistResponse>("/api/markdown/assist-with-bot", {
    method: "POST",
    body: payload,
  });
}

export async function updateSiteSettings(payload: SiteSettings) {
  return requestJson<SiteSettingsResponse>("/api/site-settings", {
    method: "PUT",
    body: payload,
  });
}

export async function uploadSiteIcon(formData: FormData) {
  return requestJson<IconUploadResponse>("/api/site-settings/icon", {
    method: "POST",
    body: formData,
  });
}

export async function uploadApplePushCertificate(environment: "dev" | "prod", formData: FormData) {
  return requestJson<SiteSettingsResponse>(`/api/site-settings/apple-push-cert?env=${environment}`, {
    method: "POST",
    body: formData,
  });
}

export async function deleteApplePushCertificate(environment: "dev" | "prod") {
  return requestJson<SiteSettingsResponse>(`/api/site-settings/apple-push-cert?env=${environment}`, {
    method: "DELETE",
  });
}

export async function fetchPackTunnelProfiles() {
  return requestJson<PackTunnelProfileListResponse>("/api/packtunnel/profiles");
}

export async function createPackTunnelProfile(payload: PackTunnelProfilePayload) {
  return requestJson<PackTunnelProfileListResponse>("/api/packtunnel/profiles", {
    method: "POST",
    body: payload,
  });
}

export async function updatePackTunnelProfile(id: string, payload: PackTunnelProfilePayload) {
  return requestJson<PackTunnelProfileListResponse>(`/api/packtunnel/profiles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: payload,
  });
}

export async function removePackTunnelProfile(id: string) {
  return requestJson<PackTunnelProfileListResponse>(`/api/packtunnel/profiles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function activatePackTunnelProfile(id: string) {
  return requestJson<PackTunnelProfileListResponse>(`/api/packtunnel/profiles/${encodeURIComponent(id)}/activate`, {
    method: "PUT",
  });
}

export async function uploadPackTunnelRules(formData: FormData) {
  return requestJson<PackTunnelRuleResponse>("/api/packtunnel/rules", {
    method: "POST",
    body: formData,
  });
}

export async function deletePackTunnelRules() {
  return requestJson<PackTunnelRuleResponse>("/api/packtunnel/rules", {
    method: "DELETE",
  });
}

export async function deleteEntry(id: number) {
  return request(`/api/markdown/${id}`, {
    method: "DELETE",
  });
}

export async function downloadPackTunnelRules() {
  return request("/api/packtunnel/rules");
}

// ---------------------------------------------------------------------------
// Latch — Proxies
// ---------------------------------------------------------------------------

export async function fetchLatchProxies() {
  return requestJson<LatchProxyListResponse>("/api/latch/proxies");
}

export async function createLatchProxy(payload: { name: string; type: string; config: unknown }) {
  return requestJson<LatchProxyListResponse>("/api/latch/proxies", { method: "POST", body: payload });
}

export async function updateLatchProxy(groupId: string, payload: { name: string; type: string; config: unknown }) {
  return requestJson<LatchProxyListResponse>(`/api/latch/proxies/${encodeURIComponent(groupId)}`, { method: "PUT", body: payload });
}

export async function removeLatchProxy(groupId: string) {
  return requestJson<LatchProxyListResponse>(`/api/latch/proxies/${encodeURIComponent(groupId)}`, { method: "DELETE" });
}

export async function fetchLatchProxyVersions(groupId: string) {
  return requestJson<LatchProxyListResponse>(`/api/latch/proxies/${encodeURIComponent(groupId)}/versions`);
}

export async function rollbackLatchProxy(groupId: string, version: number) {
  return requestJson<LatchProxyListResponse>(`/api/latch/proxies/${encodeURIComponent(groupId)}/rollback/${version}`, { method: "PUT" });
}

// ---------------------------------------------------------------------------
// Latch — Rules
// ---------------------------------------------------------------------------

export async function fetchLatchRules() {
  return requestJson<LatchRuleListResponse>("/api/latch/rules");
}

export async function createLatchRule(payload: { name: string; content: string }) {
  return requestJson<LatchRuleListResponse>("/api/latch/rules", { method: "POST", body: payload });
}

export async function createLatchRuleFromFile(formData: FormData) {
  return requestJson<LatchRuleListResponse>("/api/latch/rules/upload", { method: "POST", body: formData });
}

export async function updateLatchRule(groupId: string, payload: { name: string; content: string }) {
  return requestJson<LatchRuleListResponse>(`/api/latch/rules/${encodeURIComponent(groupId)}`, { method: "PUT", body: payload });
}

export async function uploadLatchRuleFile(groupId: string, formData: FormData) {
  return requestJson<LatchRuleListResponse>(`/api/latch/rules/${encodeURIComponent(groupId)}/upload`, { method: "POST", body: formData });
}

export async function removeLatchRule(groupId: string) {
  return requestJson<LatchRuleListResponse>(`/api/latch/rules/${encodeURIComponent(groupId)}`, { method: "DELETE" });
}

export async function fetchLatchRuleVersions(groupId: string) {
  return requestJson<LatchRuleListResponse>(`/api/latch/rules/${encodeURIComponent(groupId)}/versions`);
}

export async function rollbackLatchRule(groupId: string, version: number) {
  return requestJson<LatchRuleListResponse>(`/api/latch/rules/${encodeURIComponent(groupId)}/rollback/${version}`, { method: "PUT" });
}

// ---------------------------------------------------------------------------
// Latch — Profiles
// ---------------------------------------------------------------------------

export async function fetchLatchAdminProfiles() {
  return requestJson<LatchProfileListResponse>("/api/latch/admin/profiles");
}

export async function createLatchProfile(payload: { name: string; description: string; proxy_group_ids: string[]; rule_group_id: string; enabled: boolean; shareable: boolean }) {
  return requestJson<LatchProfileListResponse>("/api/latch/admin/profiles", { method: "POST", body: payload });
}

export async function updateLatchProfile(id: string, payload: { name: string; description: string; proxy_group_ids: string[]; rule_group_id: string; enabled: boolean; shareable: boolean }) {
  return requestJson<LatchProfileListResponse>(`/api/latch/admin/profiles/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
}

export async function removeLatchProfile(id: string) {
  return requestJson<LatchProfileListResponse>(`/api/latch/admin/profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchLatchProfiles() {
  return requestJson<LatchProfileListResponse>("/api/latch/profiles");
}

export async function uploadUserIcon(formData: FormData) {
  return requestJson<IconUploadResponse>("/api/user/icon", {
    method: "POST",
    body: formData,
  });
}

export async function beginPasskeyRegistration() {
  return requestJson<PasskeyBeginResponse>("/api/passkey/register/begin", {
    method: "POST",
  });
}

export async function finishPasskeyRegistration(
  sessionId: string,
  payload: Record<string, unknown> | unknown[] | null
) {
  return requestJson<PasskeyListResponse>("/api/passkey/register/finish", {
    method: "POST",
    headers: {
      "X-Passkey-Session": sessionId,
    },
    body: payload,
  });
}

export async function fetchPasskeys() {
  return requestJson<PasskeyListResponse>("/api/passkeys");
}

export async function removePasskey(credentialId: string) {
  return requestJson<PasskeyListResponse>(`/api/passkeys/${encodeURIComponent(credentialId)}`, {
    method: "DELETE",
  });
}
