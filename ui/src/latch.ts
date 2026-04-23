import {
  fetchLatchProxies,
  createLatchProxy,
  updateLatchProxy,
  removeLatchProxy,
  fetchLatchProxyVersions,
  rollbackLatchProxy,
  fetchLatchRules,
  createLatchRule,
  createLatchRuleFromFile,
  updateLatchRule,
  uploadLatchRuleFile,
  removeLatchRule,
  fetchLatchRuleVersions,
  rollbackLatchRule,
  fetchLatchAdminProfiles,
  createLatchProfile,
  updateLatchProfile,
  removeLatchProfile,
  fetchLatchProfiles,
  fetchLatchServiceNodes,
  createLatchServiceNode,
  updateLatchServiceNode,
  removeLatchServiceNode,
  issueLatchServiceNodeAgentToken,
} from "./api/dashboard.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { byId } from "./lib/dom.js";
import { logout } from "./api/session.js";
import type {
  LatchProxy,
  LatchRule,
  LatchProfile,
  LatchProfileDetail,
  LatchServiceNode,
} from "./types/dashboard.js";

// ---------------------------------------------------------------------------
// DOM refs — layout
// ---------------------------------------------------------------------------

const lpOverlay       = byId<HTMLElement>("lpOverlay");
const latchWelcome    = byId<HTMLElement>("latchWelcome");

// Tabs / panels
const latchTabProxies  = byId<HTMLButtonElement>("latchTabProxies");
const latchTabRules    = byId<HTMLButtonElement>("latchTabRules");
const latchSubtabBtns  = document.querySelectorAll<HTMLButtonElement>("[data-latch-tab]");
const latchTabPanels   = document.querySelectorAll<HTMLElement>("[data-latch-panel]");

// Sidebar nav
const lpNavBtns = document.querySelectorAll<HTMLButtonElement>("[data-lp-nav]");

// Proxy section
const latchProxyStatus  = byId<HTMLElement>("latchProxyStatus");
const latchProxyList    = byId<HTMLElement>("latchProxyList");         // <tbody>
const lpAddProxyBtn     = byId<HTMLButtonElement>("lpAddProxyBtn");
const lpProxySearch     = byId<HTMLInputElement>("lpProxySearch");
const lpAddServiceNodeBtn = byId<HTMLButtonElement>("lpAddServiceNodeBtn");
const latchServiceNodeStatus = byId<HTMLElement>("latchServiceNodeStatus");
const latchServiceNodeList = byId<HTMLElement>("latchServiceNodeList");

// Rule section
const latchRuleStatus   = byId<HTMLElement>("latchRuleStatus");
const latchRuleList     = byId<HTMLElement>("latchRuleList");           // <tbody>
const lpAddRuleBtn      = byId<HTMLButtonElement>("lpAddRuleBtn");
const lpRuleSearch      = byId<HTMLInputElement>("lpRuleSearch");

// Profile section (admin)
const latchProfileAdminGrid = byId<HTMLElement>("latchProfileAdminGrid");
const latchProfileStatus    = byId<HTMLElement>("latchProfileStatus");
const latchProfileList      = byId<HTMLElement>("latchProfileList");    // <tbody>
const lpAddProfileBtn       = byId<HTMLButtonElement>("lpAddProfileBtn");

// Profile section (user)
const latchProfileUserView  = byId<HTMLElement>("latchProfileUserView");
const latchProfileUserList  = byId<HTMLElement>("latchProfileUserList");

// Advanced config quick-nav
const lpGoRules    = byId<HTMLButtonElement>("lpGoRules");
const lpGoRulesAlt = byId<HTMLButtonElement>("lpGoRulesAlt");
const lpGoProfiles = byId<HTMLButtonElement>("lpGoProfiles");

// Proxy slide panel
const lpProxyPanel       = byId<HTMLElement>("lpProxyPanel");
const lpProxyClose       = byId<HTMLButtonElement>("lpProxyClose");
const latchProxyFormTitle  = byId<HTMLElement>("latchProxyFormTitle");
const latchProxyNameInput  = byId<HTMLInputElement>("latchProxyNameInput");
const latchProxyTypeSelect = byId<HTMLSelectElement>("latchProxyTypeSelect");
const latchProxyConfigInput= byId<HTMLTextAreaElement>("latchProxyConfigInput");
const latchProxyFromNodeSelect = byId<HTMLSelectElement>("latchProxyFromNodeSelect");
const latchProxyCopyNodeBtn = byId<HTMLButtonElement>("latchProxyCopyNodeBtn");
const latchProxyResetBtn   = byId<HTMLButtonElement>("latchProxyResetBtn");
const latchProxySubmitBtn  = byId<HTMLButtonElement>("latchProxySubmitBtn");

// Service node slide panel
const lpServiceNodePanel = byId<HTMLElement>("lpServiceNodePanel");
const lpServiceNodeClose = byId<HTMLButtonElement>("lpServiceNodeClose");
const latchServiceNodeFormTitle = byId<HTMLElement>("latchServiceNodeFormTitle");
const latchServiceNodeNameInput = byId<HTMLInputElement>("latchServiceNodeNameInput");
const latchServiceNodeIPInput = byId<HTMLInputElement>("latchServiceNodeIPInput");
const latchServiceNodePortInput = byId<HTMLInputElement>("latchServiceNodePortInput");
const latchServiceNodeTypeSelect = byId<HTMLSelectElement>("latchServiceNodeTypeSelect");
const latchServiceNodeStatusSelect = byId<HTMLSelectElement>("latchServiceNodeStatusSelect");
const latchServiceNodeCfgPassword = byId<HTMLInputElement>("latchServiceNodeCfgPassword");
const latchServiceNodeCfgMethod = byId<HTMLInputElement>("latchServiceNodeCfgMethod");
const latchServiceNodeCfgKey = byId<HTMLInputElement>("latchServiceNodeCfgKey");
const latchServiceNodeCfgCrypt = byId<HTMLInputElement>("latchServiceNodeCfgCrypt");
const latchServiceNodeCfgMode = byId<HTMLInputElement>("latchServiceNodeCfgMode");
const latchServiceNodeCfgMTU = byId<HTMLInputElement>("latchServiceNodeCfgMTU");
const latchServiceNodeCfgPrivateKey = byId<HTMLInputElement>("latchServiceNodeCfgPrivateKey");
const latchServiceNodeCfgPublicKey = byId<HTMLInputElement>("latchServiceNodeCfgPublicKey");
const latchServiceNodeCfgEndpoint = byId<HTMLInputElement>("latchServiceNodeCfgEndpoint");
const latchServiceNodeCfgAllowedIPs = byId<HTMLInputElement>("latchServiceNodeCfgAllowedIPs");
const latchServiceNodeCfgWireguardRole = byId<HTMLSelectElement>("latchServiceNodeCfgWireguardRole");
const latchServiceNodeConfigInput = byId<HTMLTextAreaElement>("latchServiceNodeConfigInput");
const latchServiceNodeSubmitBtn = byId<HTMLButtonElement>("latchServiceNodeSubmitBtn");
const latchServiceNodeResetBtn = byId<HTMLButtonElement>("latchServiceNodeResetBtn");

// Rule slide panel
const lpRulePanel            = byId<HTMLElement>("lpRulePanel");
const lpRuleClose            = byId<HTMLButtonElement>("lpRuleClose");
const latchRuleFormTitle     = byId<HTMLElement>("latchRuleFormTitle");
const latchRuleNameInput     = byId<HTMLInputElement>("latchRuleNameInput");
const latchRuleSourceInlineBtn = byId<HTMLButtonElement>("latchRuleSourceInlineBtn");
const latchRuleSourceFileBtn   = byId<HTMLButtonElement>("latchRuleSourceFileBtn");
const latchRuleInlineSection   = byId<HTMLElement>("latchRuleInlineSection");
const latchRuleFileSection     = byId<HTMLElement>("latchRuleFileSection");
const latchRuleContentInput    = byId<HTMLTextAreaElement>("latchRuleContentInput");
const latchRuleFileInput       = byId<HTMLInputElement>("latchRuleFileInput");
const latchRuleUploadBtn       = byId<HTMLButtonElement>("latchRuleUploadBtn");
const latchRuleResetBtn        = byId<HTMLButtonElement>("latchRuleResetBtn");
const latchRuleSubmitBtn       = byId<HTMLButtonElement>("latchRuleSubmitBtn");

// Profile slide panel
const lpProfilePanel           = byId<HTMLElement>("lpProfilePanel");
const lpProfileClose           = byId<HTMLButtonElement>("lpProfileClose");
const latchProfileFormTitle    = byId<HTMLElement>("latchProfileFormTitle");
const latchProfileNameInput    = byId<HTMLInputElement>("latchProfileNameInput");
const latchProfileDescInput    = byId<HTMLInputElement>("latchProfileDescInput");
const latchProfileEnabledInput = byId<HTMLInputElement>("latchProfileEnabledInput");
const latchProfileShareableInput = byId<HTMLInputElement>("latchProfileShareableInput");
const latchProfileProxyCheckboxes = byId<HTMLElement>("latchProfileProxyCheckboxes");
const latchProfileRuleRadios   = byId<HTMLElement>("latchProfileRuleRadios");
const latchProfileResetBtn     = byId<HTMLButtonElement>("latchProfileResetBtn");
const latchProfileSubmitBtn    = byId<HTMLButtonElement>("latchProfileSubmitBtn");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let isAdmin = false;
let editingProxyGroupId: string | null = null;
let editingRuleGroupId: string | null = null;
let editingProfileId: string | null = null;
let editingServiceNodeId: string | null = null;
let currentLatchProxies: LatchProxy[] = [];
let currentLatchRules: LatchRule[] = [];
let currentLatchProfiles: LatchProfile[] = [];
let currentServiceNodes: LatchServiceNode[] = [];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function setStatus(el: HTMLElement, msg: string, kind: "default" | "success" | "error" = "default"): void {
  el.textContent = msg;
  el.className = "status-text" + (kind === "success" ? " status-success" : kind === "error" ? " status-error" : "");
}

function proxyTypeIcon(type: string): string {
  if (type === "ss")  return `<div class="lp-type-icon ss">SS</div>`;
  if (type === "ss3") return `<div class="lp-type-icon ss3">S3</div>`;
  if (type === "wireguard") return `<div class="lp-type-icon def">WG</div>`;
  if (type.startsWith("kcp")) return `<div class="lp-type-icon kcp">KCP</div>`;
  return `<div class="lp-type-icon def">PX</div>`;
}

// ---------------------------------------------------------------------------
// Panel helpers
// ---------------------------------------------------------------------------

function openPanel(panel: HTMLElement): void {
  panel.classList.add("open");
  lpOverlay.classList.add("open");
}

function closeAllPanels(): void {
  [lpProxyPanel, lpRulePanel, lpProfilePanel, lpServiceNodePanel].forEach((p) => p.classList.remove("open"));
  lpOverlay.classList.remove("open");
}

// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------

function switchTab(tab: string): void {
  latchSubtabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.latchTab === tab));
  latchTabPanels.forEach((panel) => { panel.hidden = panel.dataset.latchPanel !== tab; });
  // Sync sidebar nav
  lpNavBtns.forEach((btn) => {
    const nav = btn.dataset.lpNav || "";
    btn.classList.toggle("active", nav === tab || (nav === "dashboard" && tab === "proxies"));
  });
}

// ---------------------------------------------------------------------------
// Proxy helpers
// ---------------------------------------------------------------------------

function resetProxyForm(): void {
  editingProxyGroupId = null;
  latchProxyNameInput.value = "";
  latchProxyTypeSelect.value = "ss";
  latchProxyFromNodeSelect.value = "";
  latchProxyConfigInput.value = "";
  latchProxyFormTitle.textContent = "Add Proxy";
  latchProxySubmitBtn.textContent = "保存代理";
  setStatus(latchProxyStatus, "");
}

function syncProxyNodeSelect(nodes: LatchServiceNode[]): void {
  if (!nodes.length) {
    latchProxyFromNodeSelect.innerHTML = `<option value="">暂无服务节点</option>`;
    latchProxyFromNodeSelect.disabled = true;
    latchProxyCopyNodeBtn.disabled = true;
    return;
  }
  latchProxyFromNodeSelect.disabled = false;
  latchProxyFromNodeSelect.innerHTML = `<option value="">选择服务节点以复制到代理配置</option>` + nodes
    .map((node) => `<option value="${node.id}">${node.name} · ${node.ip}:${node.port} · ${node.proxy_type}</option>`)
    .join("");
  latchProxyCopyNodeBtn.disabled = false;
}

function renderServiceNodes(nodes: LatchServiceNode[]): void {
  if (!nodes.length) {
    latchServiceNodeList.innerHTML = `<tr><td colspan="6"><div class="lp-empty">暂无服务节点。点击「Add Service Node」创建。</div></td></tr>`;
    return;
  }
  latchServiceNodeList.innerHTML = nodes.map((node) => `
    <tr data-latch-service-node-id="${node.id}">
      <td>
        <div class="lp-row-name">${node.name}</div>
        <div class="lp-row-meta">${node.ip}:${node.port}</div>
      </td>
      <td><span class="lp-proxy-chip">${node.proxy_type}</span></td>
      <td><span class="lp-status lp-status-active">${node.status || "unknown"}</span></td>
      <td style="font-size:12px;color:#aaa;">${new Date(node.last_updated_at || node.updated_at).toLocaleString()}</td>
      <td style="font-size:12px;color:#aaa;">${new Date(node.created_at).toLocaleDateString()}</td>
      <td>
        <div class="lp-actions">
          <button class="lp-act" type="button" title="生成 Agent Token" data-action="token">🔑</button>
          <button class="lp-act" type="button" title="编辑" data-action="edit">✎</button>
          <button class="lp-act del" type="button" title="删除" data-action="delete">✕</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function buildServiceNodeConfigFromForm(proxyType: string): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const password = latchServiceNodeCfgPassword.value.trim();
  const method = latchServiceNodeCfgMethod.value.trim();
  const key = latchServiceNodeCfgKey.value.trim();
  const crypt = latchServiceNodeCfgCrypt.value.trim();
  const mode = latchServiceNodeCfgMode.value.trim();
  const mtu = Number(latchServiceNodeCfgMTU.value || "0");
  const privateKey = latchServiceNodeCfgPrivateKey.value.trim();
  const publicKey = latchServiceNodeCfgPublicKey.value.trim();
  const endpoint = latchServiceNodeCfgEndpoint.value.trim();
  const allowedIPs = latchServiceNodeCfgAllowedIPs.value.trim();
  const wireguardRole = latchServiceNodeCfgWireguardRole.value.trim().toLowerCase();

  if (proxyType === "ss" || proxyType === "ss3" || proxyType === "kcp_over_ss" || proxyType === "kcp_over_ss3") {
    if (password) config.password = password;
    if (method) config.method = method;
  }
  if (proxyType.startsWith("kcp")) {
    if (key) config.key = key;
    if (crypt) config.crypt = crypt;
    if (mode) config.mode = mode;
    if (mtu > 0) config.mtu = mtu;
  }
  if (proxyType === "wireguard") {
    if (privateKey) config.private_key = privateKey;
    if (publicKey) config.public_key = publicKey;
    if (endpoint) config.endpoint = endpoint;
    if (allowedIPs) config.allowed_ips = allowedIPs;
    config.wireguard_role = wireguardRole === "client" ? "client" : "server";
  }
  return config;
}

function populateServiceNodeConfigForm(config: Record<string, unknown>, proxyType: string): void {
  const readString = (key: string): string => {
    const value = config[key];
    return typeof value === "string" ? value : "";
  };
  const readNumber = (key: string): number => {
    const value = config[key];
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
    return 0;
  };
  latchServiceNodeCfgPassword.value = readString("password");
  latchServiceNodeCfgMethod.value = readString("method");
  latchServiceNodeCfgKey.value = readString("key");
  latchServiceNodeCfgCrypt.value = readString("crypt");
  latchServiceNodeCfgMode.value = readString("mode");
  latchServiceNodeCfgMTU.value = String(readNumber("mtu") || 1350);
  latchServiceNodeCfgPrivateKey.value = readString("private_key");
  latchServiceNodeCfgPublicKey.value = readString("public_key");
  latchServiceNodeCfgEndpoint.value = readString("endpoint");
  latchServiceNodeCfgAllowedIPs.value = readString("allowed_ips");
  const role = readString("wireguard_role").toLowerCase();
  latchServiceNodeCfgWireguardRole.value = role === "client" ? "client" : "server";

  const autoConfig = buildServiceNodeConfigFromForm(proxyType);
  latchServiceNodeConfigInput.value = JSON.stringify(autoConfig, null, 2);
}

function refreshServiceNodeConfigPreview(): void {
  const autoConfig = buildServiceNodeConfigFromForm(latchServiceNodeTypeSelect.value);
  latchServiceNodeConfigInput.value = JSON.stringify(autoConfig, null, 2);
}

function resetServiceNodeForm(): void {
  editingServiceNodeId = null;
  latchServiceNodeNameInput.value = "";
  latchServiceNodeIPInput.value = "";
  latchServiceNodePortInput.value = "443";
  latchServiceNodeTypeSelect.value = "ss";
  latchServiceNodeStatusSelect.value = "unknown";
  latchServiceNodeCfgWireguardRole.value = "server";
  populateServiceNodeConfigForm({}, "ss");
  latchServiceNodeFormTitle.textContent = "Add Service Node";
  latchServiceNodeSubmitBtn.textContent = "保存节点";
  setStatus(latchServiceNodeStatus, "");
}

function fillServiceNodeForm(node: LatchServiceNode): void {
  editingServiceNodeId = node.id;
  latchServiceNodeNameInput.value = node.name;
  latchServiceNodeIPInput.value = node.ip;
  latchServiceNodePortInput.value = String(node.port);
  latchServiceNodeTypeSelect.value = node.proxy_type;
  latchServiceNodeStatusSelect.value = node.status || "unknown";
  populateServiceNodeConfigForm(node.config ?? {}, node.proxy_type);
  latchServiceNodeFormTitle.textContent = "Edit Service Node";
  latchServiceNodeSubmitBtn.textContent = "更新节点";
  setStatus(latchServiceNodeStatus, "");
  openPanel(lpServiceNodePanel);
}

function renderProxies(proxies: LatchProxy[]): void {
  if (!proxies.length) {
    latchProxyList.innerHTML = `<tr><td colspan="4"><div class="lp-empty">暂无代理。点击「Add Proxy」开始添加。</div></td></tr>`;
    return;
  }
  latchProxyList.innerHTML = proxies.map((p) => `
    <tr data-latch-proxy-gid="${p.group_id}">
      <td>
        <div class="lp-type-cell">
          ${proxyTypeIcon(p.type)}
          <div>
            <div class="lp-row-name">${p.name}</div>
            <div class="lp-row-meta">${p.type}</div>
          </div>
        </div>
      </td>
      <td><span class="lp-status lp-status-active">Active</span></td>
      <td>
        <span class="lp-ver">v${p.version}</span>
        <div class="lp-row-meta" style="margin-top:3px;">${p.sha1.slice(0, 12)}…</div>
      </td>
      <td>
        <div class="lp-actions">
          <button class="lp-act" type="button" title="版本历史" data-action="versions">⏱</button>
          <button class="lp-act" type="button" title="编辑" data-action="edit">✎</button>
          <button class="lp-act del" type="button" title="删除" data-action="delete">✕</button>
        </div>
      </td>
    </tr>`).join("");
}

function fillProxyForm(proxy: LatchProxy): void {
  editingProxyGroupId = proxy.group_id;
  latchProxyNameInput.value = proxy.name;
  latchProxyTypeSelect.value = proxy.type;
  latchProxyConfigInput.value = JSON.stringify(proxy.config ?? {}, null, 2);
  latchProxyFormTitle.textContent = "Edit Proxy";
  latchProxySubmitBtn.textContent = "更新代理";
  setStatus(latchProxyStatus, "");
  openPanel(lpProxyPanel);
}

// ---------------------------------------------------------------------------
// Rule helpers
// ---------------------------------------------------------------------------

function resetRuleForm(): void {
  editingRuleGroupId = null;
  latchRuleNameInput.value = "";
  latchRuleContentInput.value = "";
  latchRuleFileInput.value = "";
  latchRuleFormTitle.textContent = "Add Rule";
  latchRuleSubmitBtn.textContent = "保存规则";
  // reset to inline tab
  latchRuleInlineSection.hidden = false;
  latchRuleFileSection.hidden = true;
  latchRuleSourceInlineBtn.classList.add("active");
  latchRuleSourceFileBtn.classList.remove("active");
  setStatus(latchRuleStatus, "");
}

function renderRules(rules: LatchRule[]): void {
  if (!rules.length) {
    latchRuleList.innerHTML = `<tr><td colspan="5"><div class="lp-empty">暂无规则。</div></td></tr>`;
    return;
  }
  latchRuleList.innerHTML = rules.map((r) => `
    <tr data-latch-rule-gid="${r.group_id}">
      <td>
        <div class="lp-row-name">${r.name}</div>
        <div class="lp-row-meta" style="font-family:inherit;">${r.sha1.slice(0, 12)}…</div>
      </td>
      <td>${r.content.split("\n").filter((l) => l.trim()).length} 行</td>
      <td><span class="lp-ver">v${r.version}</span></td>
      <td style="font-size:12px;color:#aaa;">${new Date(r.created_at).toLocaleDateString()}</td>
      <td>
        <div class="lp-actions">
          <button class="lp-act" type="button" title="版本历史" data-action="versions">⏱</button>
          <button class="lp-act" type="button" title="编辑" data-action="edit">✎</button>
          <button class="lp-act del" type="button" title="删除" data-action="delete">✕</button>
        </div>
      </td>
    </tr>`).join("");
}

function fillRuleForm(rule: LatchRule): void {
  editingRuleGroupId = rule.group_id;
  latchRuleNameInput.value = rule.name;
  latchRuleContentInput.value = rule.content;
  latchRuleFormTitle.textContent = "Edit Rule";
  latchRuleSubmitBtn.textContent = "更新规则";
  latchRuleInlineSection.hidden = false;
  latchRuleFileSection.hidden = true;
  latchRuleSourceInlineBtn.classList.add("active");
  latchRuleSourceFileBtn.classList.remove("active");
  setStatus(latchRuleStatus, "");
  openPanel(lpRulePanel);
}

// ---------------------------------------------------------------------------
// Profile helpers — admin
// ---------------------------------------------------------------------------

function syncProfileSelectors(proxies: LatchProxy[], rules: LatchRule[]): void {
  latchProfileProxyCheckboxes.innerHTML = proxies.length
    ? proxies.map((p) => `
        <label class="lp-check-label lp-check-item">
          <input type="checkbox" value="${p.group_id}" />
          <span class="lp-check-text">
            <span class="lp-check-main">${p.name}</span>
            <span class="lp-check-meta">类型：${p.type}</span>
          </span>
        </label>`).join("")
    : '<span class="lp-check-empty">暂无代理</span>';

  latchProfileRuleRadios.innerHTML = `
    <label class="lp-check-label lp-check-item">
      <input type="radio" name="latch_rule" value="" checked />
      <span class="lp-check-text">
        <span class="lp-check-main lp-check-main-muted">不使用规则</span>
      </span>
    </label>` + rules.map((r) => `
    <label class="lp-check-label lp-check-item">
      <input type="radio" name="latch_rule" value="${r.group_id}" />
      <span class="lp-check-text">
        <span class="lp-check-main">${r.name}</span>
        <span class="lp-check-meta">版本：v${r.version}</span>
      </span>
    </label>`).join("");
}

function resetProfileForm(): void {
  editingProfileId = null;
  latchProfileNameInput.value = "";
  latchProfileDescInput.value = "";
  latchProfileEnabledInput.checked = true;
  latchProfileShareableInput.checked = false;
  latchProfileFormTitle.textContent = "新建配置模板";
  latchProfileSubmitBtn.textContent = "保存配置";
  setStatus(latchProfileStatus, "");
  latchProfileProxyCheckboxes.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => { cb.checked = false; });
  const noRule = latchProfileRuleRadios.querySelector<HTMLInputElement>("input[value='']");
  if (noRule) noRule.checked = true;
}

function renderAdminProfiles(profiles: LatchProfile[], proxies: LatchProxy[], rules: LatchRule[]): void {
  if (!profiles.length) {
    latchProfileList.innerHTML = `<tr><td colspan="5"><div class="lp-empty">暂无配置。</div></td></tr>`;
    return;
  }
  const proxyMap = new Map(proxies.map((p) => [p.group_id, p]));
  const ruleMap  = new Map(rules.map((r) => [r.group_id, r]));
  latchProfileList.innerHTML = profiles.map((prof) => {
    const chips = prof.proxy_group_ids
      .map((gid) => proxyMap.get(gid))
      .filter(Boolean)
      .map((p) => `<span class="lp-proxy-chip">${p!.name}</span>`)
      .join("") || `<span style="color:#bbb;font-size:12px;">—</span>`;
    const ruleLabel = prof.rule_group_id && ruleMap.get(prof.rule_group_id)
      ? `<span class="lp-ver">${ruleMap.get(prof.rule_group_id)!.name}</span>`
      : `<span style="color:#bbb;font-size:12px;">—</span>`;
    return `
      <tr data-latch-profile-id="${prof.id}">
        <td>
          <div class="lp-row-name">${prof.name}</div>
          ${prof.description ? `<div class="lp-row-meta" style="font-family:inherit;">${prof.description}</div>` : ""}
        </td>
        <td>${chips}</td>
        <td>${ruleLabel}</td>
        <td>
          ${prof.enabled   ? '<span class="lp-flag on">enabled</span>'   : '<span class="lp-flag">disabled</span>'}
          ${prof.shareable ? '<span class="lp-flag on">shared</span>'    : '<span class="lp-flag">private</span>'}
        </td>
        <td>
          <div class="lp-actions">
            <button class="lp-act" type="button" title="编辑" data-action="edit">✎</button>
            <button class="lp-act del" type="button" title="删除" data-action="delete">✕</button>
          </div>
        </td>
      </tr>`;
  }).join("");
}

function fillProfileForm(prof: LatchProfile): void {
  editingProfileId = prof.id;
  latchProfileNameInput.value = prof.name;
  latchProfileDescInput.value = prof.description || "";
  latchProfileEnabledInput.checked = prof.enabled;
  latchProfileShareableInput.checked = prof.shareable;
  latchProfileProxyCheckboxes.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.checked = prof.proxy_group_ids.includes(cb.value);
  });
  latchProfileRuleRadios.querySelectorAll<HTMLInputElement>("input[type=radio]").forEach((r) => {
    r.checked = r.value === (prof.rule_group_id || "");
  });
  latchProfileFormTitle.textContent = "编辑配置模板";
  latchProfileSubmitBtn.textContent = "更新配置";
  setStatus(latchProfileStatus, "");
  openPanel(lpProfilePanel);
}

// ---------------------------------------------------------------------------
// Profile helpers — user read-only
// ---------------------------------------------------------------------------

function renderUserProfiles(profiles: LatchProfileDetail[]): void {
  if (!profiles.length) {
    latchProfileUserList.innerHTML = `<div class="lp-empty">暂无可用配置。</div>`;
    return;
  }
  latchProfileUserList.innerHTML = profiles.map((prof) => {
    const chips = (prof.proxies || [])
      .map((p) => `<span class="lp-proxy-chip">${p.name} <span style="opacity:.6;">${p.type}</span></span>`)
      .join("") || `<span style="color:#bbb;font-size:12px;">无代理</span>`;
    const ruleLabel = prof.rule
      ? `<span class="lp-ver">${prof.rule.name} v${prof.rule.version}</span>`
      : `<span style="color:#bbb;font-size:12px;">无规则</span>`;
    return `
      <div class="lp-user-card">
        <div class="lp-user-card-name">${prof.name}</div>
        ${prof.description ? `<div class="lp-user-card-desc">${prof.description}</div>` : ""}
        <div class="lp-user-card-row">
          <span style="color:#aaa;font-size:12px;">代理：</span>${chips}
        </div>
        <div class="lp-user-card-row">
          <span style="color:#aaa;font-size:12px;">规则：</span>${ruleLabel}
        </div>
      </div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadAdminData(): Promise<void> {
  const [proxyRes, ruleRes, profileRes, nodeRes] = await Promise.all([
    fetchLatchProxies(),
    fetchLatchRules(),
    fetchLatchAdminProfiles(),
    fetchLatchServiceNodes(false),
  ]);
  currentLatchProxies  = proxyRes.response.ok   ? (proxyRes.data.proxies   as LatchProxy[]   || []) : [];
  currentLatchRules    = ruleRes.response.ok     ? (ruleRes.data.rules     as LatchRule[]     || []) : [];
  currentLatchProfiles = profileRes.response.ok ? (profileRes.data.profiles as LatchProfile[] || []) : [];
  currentServiceNodes = nodeRes.response.ok ? (nodeRes.data.nodes as LatchServiceNode[] || []) : [];
  renderProxies(currentLatchProxies);
  renderRules(currentLatchRules);
  renderServiceNodes(currentServiceNodes);
  syncProxyNodeSelect(currentServiceNodes);
  renderAdminProfiles(currentLatchProfiles, currentLatchProxies, currentLatchRules);
  syncProfileSelectors(currentLatchProxies, currentLatchRules);
}

async function loadUserData(): Promise<void> {
  const { response, data } = await fetchLatchProfiles();
  const profiles = response.ok ? (data.profiles as LatchProfileDetail[] || []) : [];
  renderUserProfiles(profiles);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  initStoredTheme();
  bindThemeSync();
  hydrateSiteBrand();

  const res = await fetch("/api/me", { credentials: "include" });
  if (!res.ok) { window.location.href = "/login.html"; return; }
  const me = await res.json();
  isAdmin = me.role === "admin";

  latchWelcome.textContent = isAdmin ? "管理员模式" : "只读模式";
  renderSidebarFoot(me);

  if (isAdmin) {
    latchTabProxies.hidden = false;
    latchTabRules.hidden   = false;
    latchProfileAdminGrid.hidden  = false;
    latchProfileUserView.hidden   = true;
    switchTab("proxies");
    await loadAdminData();
    wireAdminEvents();
  } else {
    latchTabProxies.hidden = true;
    latchTabRules.hidden   = true;
    latchProfileAdminGrid.hidden  = true;
    latchProfileUserView.hidden   = false;
    switchTab("profiles");
    await loadUserData();
  }
}

// ---------------------------------------------------------------------------
// Admin event handlers
// ---------------------------------------------------------------------------

function wireAdminEvents(): void {
  // Tabs
  latchSubtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.latchTab || "proxies"));
  });

  // Sidebar nav quick-switch
  lpNavBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const nav = btn.dataset.lpNav || "";
      if (nav === "proxies" || nav === "dashboard") { switchTab("proxies"); return; }
      if (nav === "rules")    { switchTab("rules");    return; }
      if (nav === "profiles") { switchTab("profiles"); return; }
    });
  });

  // Advanced card shortcuts
  lpGoRules.addEventListener("click",    () => switchTab("rules"));
  lpGoRulesAlt.addEventListener("click", () => switchTab("rules"));
  lpGoProfiles.addEventListener("click", () => switchTab("profiles"));

  // Overlay / close
  lpOverlay.addEventListener("click", closeAllPanels);
  lpProxyClose.addEventListener("click",   closeAllPanels);
  lpRuleClose.addEventListener("click",    closeAllPanels);
  lpProfileClose.addEventListener("click", closeAllPanels);
  lpServiceNodeClose.addEventListener("click", closeAllPanels);

  // — Proxy panel —
  lpAddProxyBtn.addEventListener("click", () => {
    resetProxyForm();
    openPanel(lpProxyPanel);
    latchProxyNameInput.focus();
  });

  latchProxyCopyNodeBtn.addEventListener("click", () => {
    const nodeID = latchProxyFromNodeSelect.value;
    if (!nodeID) {
      setStatus(latchProxyStatus, "请先选择服务节点", "error");
      return;
    }
    const node = currentServiceNodes.find((item) => item.id === nodeID);
    if (!node) {
      setStatus(latchProxyStatus, "服务节点不存在或已删除", "error");
      return;
    }
    latchProxyNameInput.value = `${node.name}`;
    latchProxyTypeSelect.value = node.proxy_type;
    const mergedConfig = {
      server: node.ip,
      port: node.port,
      ...(typeof node.config === "object" && node.config ? node.config : {}),
    };
    latchProxyConfigInput.value = JSON.stringify(mergedConfig, null, 2);
    setStatus(latchProxyStatus, `已从服务节点「${node.name}」复制配置`, "success");
  });

  latchProxyResetBtn.addEventListener("click", resetProxyForm);

  latchProxySubmitBtn.addEventListener("click", async () => {
    const name = latchProxyNameInput.value.trim();
    const type = latchProxyTypeSelect.value;
    const raw  = latchProxyConfigInput.value.trim();
    if (!name) { setStatus(latchProxyStatus, "请填写代理名称", "error"); return; }
    let config: unknown = {};
    if (raw) {
      try { config = JSON.parse(raw); } catch {
        setStatus(latchProxyStatus, "配置 JSON 格式有误", "error"); return;
      }
    }
    latchProxySubmitBtn.disabled = true;
    setStatus(latchProxyStatus, editingProxyGroupId ? "正在更新…" : "正在创建…");
    try {
      const { response, data } = editingProxyGroupId
        ? await updateLatchProxy(editingProxyGroupId, { name, type, config })
        : await createLatchProxy({ name, type, config });
      if (!response.ok) { setStatus(latchProxyStatus, data.error || "保存失败", "error"); return; }
      setStatus(latchProxyStatus, data.message || "已保存", "success");
      closeAllPanels();
      resetProxyForm();
      await loadAdminData();
    } catch { setStatus(latchProxyStatus, "网络错误，请重试", "error"); }
    finally   { latchProxySubmitBtn.disabled = false; }
  });

  // Search filter
  lpProxySearch.addEventListener("input", () => {
    const q = lpProxySearch.value.trim().toLowerCase();
    latchProxyList.querySelectorAll<HTMLTableRowElement>("tr[data-latch-proxy-gid]").forEach((row) => {
      const text = row.textContent?.toLowerCase() || "";
      row.hidden = !!q && !text.includes(q);
    });
  });

  latchProxyList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-latch-proxy-gid]");
    const gid = row?.dataset.latchProxyGid || "";
    const proxy = currentLatchProxies.find((p) => p.group_id === gid);
    if (!proxy) return;
    const action = btn.dataset.action;

    if (action === "edit") { fillProxyForm(proxy); return; }

    if (action === "versions") {
      try {
        const { response, data } = await fetchLatchProxyVersions(gid);
        if (!response.ok) { setStatus(latchProxyStatus, data.error || "获取失败", "error"); return; }
        const versions = data.versions || [];
        const pick = window.prompt(
          `代理 "${proxy.name}" 版本历史 (当前 v${proxy.version}):\n` +
          versions.map((v) => `v${v.version}  SHA1:${v.sha1.slice(0, 8)}  ${new Date(v.created_at).toLocaleString()}`).join("\n") +
          "\n\n输入要回滚到的版本号 (留空取消):"
        );
        if (!pick) return;
        const ver = parseInt(pick, 10);
        if (!ver || ver === proxy.version) { setStatus(latchProxyStatus, "版本未变", "default"); return; }
        const { response: r2, data: d2 } = await rollbackLatchProxy(gid, ver);
        if (!r2.ok) { setStatus(latchProxyStatus, d2.error || "回滚失败", "error"); return; }
        setStatus(latchProxyStatus, d2.message || "回滚成功", "success");
        await loadAdminData();
      } catch { setStatus(latchProxyStatus, "网络错误，请重试", "error"); }
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`确定删除代理 "${proxy.name}" 的所有版本吗？`)) return;
      try {
        const { response, data } = await removeLatchProxy(gid);
        if (!response.ok) { setStatus(latchProxyStatus, data.error || "删除失败", "error"); return; }
        if (editingProxyGroupId === gid) { closeAllPanels(); resetProxyForm(); }
        setStatus(latchProxyStatus, data.message || "已删除", "success");
        await loadAdminData();
      } catch { setStatus(latchProxyStatus, "网络错误，请重试", "error"); }
    }
  });

  // — Service node panel —
  lpAddServiceNodeBtn.addEventListener("click", () => {
    resetServiceNodeForm();
    openPanel(lpServiceNodePanel);
    latchServiceNodeNameInput.focus();
  });

  latchServiceNodeResetBtn.addEventListener("click", resetServiceNodeForm);
  latchServiceNodeTypeSelect.addEventListener("change", refreshServiceNodeConfigPreview);
  [
    latchServiceNodeCfgPassword,
    latchServiceNodeCfgMethod,
    latchServiceNodeCfgKey,
    latchServiceNodeCfgCrypt,
    latchServiceNodeCfgMode,
    latchServiceNodeCfgMTU,
    latchServiceNodeCfgPrivateKey,
    latchServiceNodeCfgPublicKey,
    latchServiceNodeCfgEndpoint,
    latchServiceNodeCfgAllowedIPs,
  ].forEach((input) => input.addEventListener("input", refreshServiceNodeConfigPreview));
  latchServiceNodeCfgWireguardRole.addEventListener("change", refreshServiceNodeConfigPreview);

  latchServiceNodeSubmitBtn.addEventListener("click", async () => {
    const name = latchServiceNodeNameInput.value.trim();
    const ip = latchServiceNodeIPInput.value.trim();
    const port = Number(latchServiceNodePortInput.value || "0");
    const proxyType = latchServiceNodeTypeSelect.value;
    const status = latchServiceNodeStatusSelect.value || "unknown";

    if (!name || !ip || !proxyType || !port) {
      setStatus(latchServiceNodeStatus, "请填写名称/IP/端口/类型", "error");
      return;
    }
    if (port <= 0 || port > 65535) {
      setStatus(latchServiceNodeStatus, "端口必须在 1-65535", "error");
      return;
    }
    const config = buildServiceNodeConfigFromForm(proxyType);
    latchServiceNodeSubmitBtn.disabled = true;
    setStatus(latchServiceNodeStatus, editingServiceNodeId ? "正在更新节点…" : "正在创建节点…");
    try {
      const payload = { name, ip, port, proxy_type: proxyType, config, status };
      const { response, data } = editingServiceNodeId
        ? await updateLatchServiceNode(editingServiceNodeId, payload)
        : await createLatchServiceNode(payload);
      if (!response.ok) {
        setStatus(latchServiceNodeStatus, data.error || "保存失败", "error");
        return;
      }
      setStatus(latchServiceNodeStatus, data.message || "已保存", "success");
      closeAllPanels();
      resetServiceNodeForm();
      await loadAdminData();
    } catch {
      setStatus(latchServiceNodeStatus, "网络错误，请重试", "error");
    } finally {
      latchServiceNodeSubmitBtn.disabled = false;
    }
  });

  latchServiceNodeList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-latch-service-node-id]");
    const id = row?.dataset.latchServiceNodeId || "";
    const node = currentServiceNodes.find((item) => item.id === id);
    if (!node) return;
    const action = btn.dataset.action;
    if (action === "token") {
      try {
        const { response, data } = await issueLatchServiceNodeAgentToken(id);
        if (!response.ok) {
          setStatus(latchServiceNodeStatus, data.error || "生成 token 失败", "error");
          return;
        }
        const token = (data as { token?: string }).token || "";
        if (!token) {
          setStatus(latchServiceNodeStatus, "token 返回为空", "error");
          return;
        }
        window.prompt(`Agent token（仅显示一次，请立即保存）\n节点：${node.name}`, token);
        setStatus(latchServiceNodeStatus, "Agent token 已生成", "success");
      } catch {
        setStatus(latchServiceNodeStatus, "网络错误，请重试", "error");
      }
      return;
    }
    if (action === "edit") {
      fillServiceNodeForm(node);
      return;
    }
    if (action === "delete") {
      if (!window.confirm(`确定删除服务节点 "${node.name}" 吗？`)) return;
      try {
        const { response, data } = await removeLatchServiceNode(id);
        if (!response.ok) {
          setStatus(latchServiceNodeStatus, data.error || "删除失败", "error");
          return;
        }
        if (editingServiceNodeId === id) {
          closeAllPanels();
          resetServiceNodeForm();
        }
        setStatus(latchServiceNodeStatus, data.message || "已删除", "success");
        await loadAdminData();
      } catch {
        setStatus(latchServiceNodeStatus, "网络错误，请重试", "error");
      }
    }
  });

  // — Rule panel —
  lpAddRuleBtn.addEventListener("click", () => {
    resetRuleForm();
    openPanel(lpRulePanel);
    latchRuleNameInput.focus();
  });

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

  latchRuleResetBtn.addEventListener("click", resetRuleForm);

  latchRuleSubmitBtn.addEventListener("click", async () => {
    const name    = latchRuleNameInput.value.trim();
    const content = latchRuleContentInput.value;
    if (!name) { setStatus(latchRuleStatus, "请填写规则名称", "error"); return; }
    latchRuleSubmitBtn.disabled = true;
    setStatus(latchRuleStatus, editingRuleGroupId ? "正在更新…" : "正在创建…");
    try {
      const { response, data } = editingRuleGroupId
        ? await updateLatchRule(editingRuleGroupId, { name, content })
        : await createLatchRule({ name, content });
      if (!response.ok) { setStatus(latchRuleStatus, data.error || "保存失败", "error"); return; }
      setStatus(latchRuleStatus, data.message || "已保存", "success");
      closeAllPanels();
      resetRuleForm();
      await loadAdminData();
    } catch { setStatus(latchRuleStatus, "网络错误，请重试", "error"); }
    finally   { latchRuleSubmitBtn.disabled = false; }
  });

  latchRuleUploadBtn.addEventListener("click", async () => {
    const name = latchRuleNameInput.value.trim();
    const file = latchRuleFileInput.files?.[0];
    if (!file) { setStatus(latchRuleStatus, "请先选择文件", "error"); return; }
    const fd = new FormData();
    if (name) fd.append("name", name);
    fd.append("file", file);
    latchRuleUploadBtn.disabled = true;
    setStatus(latchRuleStatus, "正在上传…");
    try {
      const { response, data } = editingRuleGroupId
        ? await uploadLatchRuleFile(editingRuleGroupId, fd)
        : await createLatchRuleFromFile(fd);
      if (!response.ok) { setStatus(latchRuleStatus, data.error || "上传失败", "error"); return; }
      setStatus(latchRuleStatus, data.message || "上传成功", "success");
      closeAllPanels();
      resetRuleForm();
      await loadAdminData();
    } catch { setStatus(latchRuleStatus, "网络错误，请重试", "error"); }
    finally   { latchRuleUploadBtn.disabled = false; }
  });

  lpRuleSearch.addEventListener("input", () => {
    const q = lpRuleSearch.value.trim().toLowerCase();
    latchRuleList.querySelectorAll<HTMLTableRowElement>("tr[data-latch-rule-gid]").forEach((row) => {
      row.hidden = !!q && !(row.textContent?.toLowerCase().includes(q));
    });
  });

  latchRuleList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-latch-rule-gid]");
    const gid = row?.dataset.latchRuleGid || "";
    const rule = currentLatchRules.find((r) => r.group_id === gid);
    if (!rule) return;
    const action = btn.dataset.action;

    if (action === "edit") { fillRuleForm(rule); return; }

    if (action === "versions") {
      try {
        const { response, data } = await fetchLatchRuleVersions(gid);
        if (!response.ok) { setStatus(latchRuleStatus, data.error || "获取失败", "error"); return; }
        const versions = data.versions || [];
        const pick = window.prompt(
          `规则 "${rule.name}" 版本历史 (当前 v${rule.version}):\n` +
          versions.map((v) => `v${v.version}  SHA1:${v.sha1.slice(0, 8)}  ${new Date(v.created_at).toLocaleString()}`).join("\n") +
          "\n\n输入要回滚到的版本号 (留空取消):"
        );
        if (!pick) return;
        const ver = parseInt(pick, 10);
        if (!ver || ver === rule.version) { setStatus(latchRuleStatus, "版本未变", "default"); return; }
        const { response: r2, data: d2 } = await rollbackLatchRule(gid, ver);
        if (!r2.ok) { setStatus(latchRuleStatus, d2.error || "回滚失败", "error"); return; }
        setStatus(latchRuleStatus, d2.message || "回滚成功", "success");
        await loadAdminData();
      } catch { setStatus(latchRuleStatus, "网络错误，请重试", "error"); }
      return;
    }

    if (action === "delete") {
      if (!window.confirm(`确定删除规则 "${rule.name}" 的所有版本吗？`)) return;
      try {
        const { response, data } = await removeLatchRule(gid);
        if (!response.ok) { setStatus(latchRuleStatus, data.error || "删除失败", "error"); return; }
        if (editingRuleGroupId === gid) { closeAllPanels(); resetRuleForm(); }
        setStatus(latchRuleStatus, data.message || "已删除", "success");
        await loadAdminData();
      } catch { setStatus(latchRuleStatus, "网络错误，请重试", "error"); }
    }
  });

  // — Profile panel —
  lpAddProfileBtn.addEventListener("click", () => {
    resetProfileForm();
    openPanel(lpProfilePanel);
    latchProfileNameInput.focus();
  });

  latchProfileResetBtn.addEventListener("click", resetProfileForm);

  latchProfileSubmitBtn.addEventListener("click", async () => {
    const name = latchProfileNameInput.value.trim();
    if (!name) { setStatus(latchProfileStatus, "请填写配置名称", "error"); return; }
    const proxyGroupIds = Array.from(
      latchProfileProxyCheckboxes.querySelectorAll<HTMLInputElement>("input[type=checkbox]:checked")
    ).map((cb) => cb.value);
    const ruleRadio = latchProfileRuleRadios.querySelector<HTMLInputElement>("input[type=radio]:checked");
    const payload = {
      name,
      description: latchProfileDescInput.value.trim(),
      proxy_group_ids: proxyGroupIds,
      rule_group_id: ruleRadio?.value || "",
      enabled: latchProfileEnabledInput.checked,
      shareable: latchProfileShareableInput.checked,
    };
    latchProfileSubmitBtn.disabled = true;
    setStatus(latchProfileStatus, editingProfileId ? "正在更新…" : "正在创建…");
    try {
      const { response, data } = editingProfileId
        ? await updateLatchProfile(editingProfileId, payload)
        : await createLatchProfile(payload);
      if (!response.ok) { setStatus(latchProfileStatus, data.error || "保存失败", "error"); return; }
      setStatus(latchProfileStatus, data.message || "已保存", "success");
      closeAllPanels();
      resetProfileForm();
      await loadAdminData();
    } catch { setStatus(latchProfileStatus, "网络错误，请重试", "error"); }
    finally   { latchProfileSubmitBtn.disabled = false; }
  });

  latchProfileList.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
    if (!btn) return;
    const row = btn.closest<HTMLElement>("[data-latch-profile-id]");
    const id  = row?.dataset.latchProfileId || "";
    const prof = currentLatchProfiles.find((p) => p.id === id);
    if (!prof) return;
    const action = btn.dataset.action;

    if (action === "edit") { fillProfileForm(prof); return; }

    if (action === "delete") {
      if (!window.confirm(`确定删除配置 "${prof.name}" 吗？`)) return;
      try {
        const { response, data } = await removeLatchProfile(id);
        if (!response.ok) { setStatus(latchProfileStatus, data.error || "删除失败", "error"); return; }
        if (editingProfileId === id) { closeAllPanels(); resetProfileForm(); }
        setStatus(latchProfileStatus, data.message || "已删除", "success");
        await loadAdminData();
      } catch { setStatus(latchProfileStatus, "网络错误，请重试", "error"); }
    }
  });
}

init();

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await logout(); } finally { window.location.replace("/login.html"); }
});
