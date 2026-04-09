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
} from "./api/dashboard.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { byId } from "./lib/dom.js";
import type {
  LatchProxy,
  LatchRule,
  LatchProfile,
  LatchProfileDetail,
} from "./types/dashboard.js";

// ---------------------------------------------------------------------------
// DOM refs — layout
// ---------------------------------------------------------------------------

const lpOverlay       = byId<HTMLElement>("lpOverlay");
const latchWelcome    = byId<HTMLElement>("latchWelcome");
const lpFootAvatar    = byId<HTMLElement>("lpFootAvatar");
const lpFootName      = byId<HTMLElement>("lpFootName");
const lpFootRole      = byId<HTMLElement>("lpFootRole");

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
const latchProxyResetBtn   = byId<HTMLButtonElement>("latchProxyResetBtn");
const latchProxySubmitBtn  = byId<HTMLButtonElement>("latchProxySubmitBtn");

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
let currentLatchProxies: LatchProxy[] = [];
let currentLatchRules: LatchRule[] = [];
let currentLatchProfiles: LatchProfile[] = [];

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
  [lpProxyPanel, lpRulePanel, lpProfilePanel].forEach((p) => p.classList.remove("open"));
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
  latchProxyConfigInput.value = "";
  latchProxyFormTitle.textContent = "Add Proxy";
  latchProxySubmitBtn.textContent = "保存代理";
  setStatus(latchProxyStatus, "");
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
        <label class="lp-check-label" style="padding:4px 0;">
          <input type="checkbox" value="${p.group_id}" />
          <span>${p.name} <span class="lp-proxy-chip">${p.type}</span></span>
        </label>`).join("")
    : '<span style="color:var(--muted,#aaa);font-size:13px;padding:4px;">暂无代理</span>';

  latchProfileRuleRadios.innerHTML = `
    <label class="lp-check-label" style="padding:4px 0;">
      <input type="radio" name="latch_rule" value="" checked />
      <span style="color:#aaa;">不使用规则</span>
    </label>` + rules.map((r) => `
    <label class="lp-check-label" style="padding:4px 0;">
      <input type="radio" name="latch_rule" value="${r.group_id}" />
      <span>${r.name} <span class="lp-ver">v${r.version}</span></span>
    </label>`).join("");
}

function resetProfileForm(): void {
  editingProfileId = null;
  latchProfileNameInput.value = "";
  latchProfileDescInput.value = "";
  latchProfileEnabledInput.checked = true;
  latchProfileShareableInput.checked = false;
  latchProfileFormTitle.textContent = "Add Profile";
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
  latchProfileFormTitle.textContent = "Edit Profile";
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
  const [proxyRes, ruleRes, profileRes] = await Promise.all([
    fetchLatchProxies(),
    fetchLatchRules(),
    fetchLatchAdminProfiles(),
  ]);
  currentLatchProxies  = proxyRes.response.ok   ? (proxyRes.data.proxies   as LatchProxy[]   || []) : [];
  currentLatchRules    = ruleRes.response.ok     ? (ruleRes.data.rules     as LatchRule[]     || []) : [];
  currentLatchProfiles = profileRes.response.ok ? (profileRes.data.profiles as LatchProfile[] || []) : [];
  renderProxies(currentLatchProxies);
  renderRules(currentLatchRules);
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
  lpFootName.textContent = me.username || "—";
  lpFootRole.textContent = isAdmin ? "Administrator" : "Member";
  lpFootAvatar.textContent = (me.username || "U")[0].toUpperCase();

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

  // — Proxy panel —
  lpAddProxyBtn.addEventListener("click", () => {
    resetProxyForm();
    openPanel(lpProxyPanel);
    latchProxyNameInput.focus();
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
