import { fetchLatchProxies, createLatchProxy, updateLatchProxy, removeLatchProxy, fetchLatchProxyVersions, rollbackLatchProxy, fetchLatchRules, createLatchRule, createLatchRuleFromFile, updateLatchRule, uploadLatchRuleFile, removeLatchRule, fetchLatchRuleVersions, rollbackLatchRule, fetchLatchAdminProfiles, createLatchProfile, updateLatchProfile, removeLatchProfile, fetchLatchProfiles, } from "./api/dashboard.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { byId } from "./lib/dom.js";
// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const latchWelcome = byId("latchWelcome");
const latchTabProxies = byId("latchTabProxies");
const latchTabRules = byId("latchTabRules");
const latchSubtabBtns = document.querySelectorAll("[data-latch-tab]");
const latchTabPanels = document.querySelectorAll("[data-latch-panel]");
// Proxies
const latchProxyFormTitle = byId("latchProxyFormTitle");
const latchProxyNameInput = byId("latchProxyNameInput");
const latchProxyTypeSelect = byId("latchProxyTypeSelect");
const latchProxyConfigInput = byId("latchProxyConfigInput");
const latchProxyResetBtn = byId("latchProxyResetBtn");
const latchProxySubmitBtn = byId("latchProxySubmitBtn");
const latchProxyStatus = byId("latchProxyStatus");
const latchProxyList = byId("latchProxyList");
// Rules
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
// Profiles — admin form
const latchProfileAdminGrid = byId("latchProfileAdminGrid");
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
// Profiles — user read-only view
const latchProfileUserView = byId("latchProfileUserView");
const latchProfileUserList = byId("latchProfileUserList");
// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isAdmin = false;
let editingLatchProxyGroupId = null;
let editingLatchRuleGroupId = null;
let editingLatchProfileId = null;
let currentLatchProxies = [];
let currentLatchRules = [];
let currentLatchProfiles = [];
// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function setStatus(el, msg, kind = "default") {
    el.textContent = msg;
    el.className = "status-text" + (kind === "success" ? " status-success" : kind === "error" ? " status-error" : "");
}
// ---------------------------------------------------------------------------
// Tab switching
// ---------------------------------------------------------------------------
function switchTab(tab) {
    latchSubtabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.latchTab === tab));
    latchTabPanels.forEach((panel) => { panel.hidden = panel.dataset.latchPanel !== tab; });
}
// ---------------------------------------------------------------------------
// Proxy helpers (admin)
// ---------------------------------------------------------------------------
function resetProxyForm() {
    editingLatchProxyGroupId = null;
    latchProxyNameInput.value = "";
    latchProxyTypeSelect.value = "ss";
    latchProxyConfigInput.value = "";
    latchProxyFormTitle.textContent = "添加代理";
    latchProxySubmitBtn.textContent = "保存代理";
    setStatus(latchProxyStatus, "");
}
function renderProxies(proxies) {
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
function fillProxyForm(proxy) {
    editingLatchProxyGroupId = proxy.group_id;
    latchProxyNameInput.value = proxy.name;
    latchProxyTypeSelect.value = proxy.type;
    latchProxyConfigInput.value = JSON.stringify(proxy.config ?? {}, null, 2);
    latchProxyFormTitle.textContent = "编辑代理";
    latchProxySubmitBtn.textContent = "更新代理";
    setStatus(latchProxyStatus, "");
}
// ---------------------------------------------------------------------------
// Rule helpers (admin)
// ---------------------------------------------------------------------------
function resetRuleForm() {
    editingLatchRuleGroupId = null;
    latchRuleNameInput.value = "";
    latchRuleContentInput.value = "";
    latchRuleFileInput.value = "";
    latchRuleFormTitle.textContent = "添加规则";
    latchRuleSubmitBtn.textContent = "保存规则";
    setStatus(latchRuleStatus, "");
}
function renderRules(rules) {
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
function fillRuleForm(rule) {
    editingLatchRuleGroupId = rule.group_id;
    latchRuleNameInput.value = rule.name;
    latchRuleContentInput.value = rule.content;
    latchRuleFormTitle.textContent = "编辑规则";
    latchRuleSubmitBtn.textContent = "更新规则";
    latchRuleInlineSection.hidden = false;
    latchRuleFileSection.hidden = true;
    latchRuleSourceInlineBtn.classList.add("active");
    latchRuleSourceFileBtn.classList.remove("active");
    setStatus(latchRuleStatus, "");
}
// ---------------------------------------------------------------------------
// Profile helpers — admin
// ---------------------------------------------------------------------------
function syncProfileSelectors(proxies, rules) {
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
function resetProfileForm() {
    editingLatchProfileId = null;
    latchProfileNameInput.value = "";
    latchProfileDescInput.value = "";
    latchProfileEnabledInput.checked = true;
    latchProfileShareableInput.checked = false;
    latchProfileFormTitle.textContent = "添加配置";
    latchProfileSubmitBtn.textContent = "保存配置";
    setStatus(latchProfileStatus, "");
    latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]").forEach((cb) => { cb.checked = false; });
    const noRule = latchProfileRuleRadios.querySelector("input[value='']");
    if (noRule)
        noRule.checked = true;
}
function renderAdminProfiles(profiles, proxies, rules) {
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
function fillProfileForm(prof) {
    editingLatchProfileId = prof.id;
    latchProfileNameInput.value = prof.name;
    latchProfileDescInput.value = prof.description || "";
    latchProfileEnabledInput.checked = prof.enabled;
    latchProfileShareableInput.checked = prof.shareable;
    latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]").forEach((cb) => {
        cb.checked = prof.proxy_group_ids.includes(cb.value);
    });
    latchProfileRuleRadios.querySelectorAll("input[type=radio]").forEach((r) => {
        r.checked = r.value === (prof.rule_group_id || "");
    });
    latchProfileFormTitle.textContent = "编辑配置";
    latchProfileSubmitBtn.textContent = "更新配置";
    setStatus(latchProfileStatus, "");
}
// ---------------------------------------------------------------------------
// Profile helpers — user read-only
// ---------------------------------------------------------------------------
function renderUserProfiles(profiles) {
    if (!profiles.length) {
        latchProfileUserList.innerHTML = '<li class="tag-item tag-item-empty">暂无可用配置。</li>';
        return;
    }
    latchProfileUserList.innerHTML = profiles.map((prof) => {
        const proxyChips = (prof.proxies || [])
            .map((p) => `<span class="latch-proxy-chip">${p.name} <span style="opacity:.6">${p.type}</span></span>`)
            .join("") || '<span style="color:var(--muted);font-size:12px">无代理</span>';
        const ruleLabel = prof.rule
            ? `<span class="latch-version-badge">${prof.rule.name} v${prof.rule.version}</span>`
            : '<span style="color:var(--muted);font-size:12px">无规则</span>';
        return `
      <li class="tag-item">
        <div class="tag-item-main">
          <div class="tag-item-header">
            <strong>${prof.name}</strong>
          </div>
          ${prof.description ? `<div class="tag-item-meta">${prof.description}</div>` : ""}
          <div class="latch-item-flags">${proxyChips}</div>
          <div class="tag-item-desc">规则：${ruleLabel}</div>
        </div>
      </li>`;
    }).join("");
}
// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------
async function loadAdminData() {
    const [proxyRes, ruleRes, profileRes] = await Promise.all([
        fetchLatchProxies(),
        fetchLatchRules(),
        fetchLatchAdminProfiles(),
    ]);
    currentLatchProxies = proxyRes.response.ok ? (proxyRes.data.proxies || []) : [];
    currentLatchRules = ruleRes.response.ok ? (ruleRes.data.rules || []) : [];
    currentLatchProfiles = profileRes.response.ok ? (profileRes.data.profiles || []) : [];
    renderProxies(currentLatchProxies);
    renderRules(currentLatchRules);
    renderAdminProfiles(currentLatchProfiles, currentLatchProxies, currentLatchRules);
    syncProfileSelectors(currentLatchProxies, currentLatchRules);
}
async function loadUserData() {
    const { response, data } = await fetchLatchProfiles();
    const profiles = response.ok ? (data.profiles || []) : [];
    renderUserProfiles(profiles);
}
// ---------------------------------------------------------------------------
// Init — auth check + role-based UI setup
// ---------------------------------------------------------------------------
async function init() {
    initStoredTheme();
    bindThemeSync();
    hydrateSiteBrand();
    const res = await fetch("/api/me", { credentials: "include" });
    if (!res.ok) {
        window.location.href = "/login.html";
        return;
    }
    const me = await res.json();
    isAdmin = me.role === "admin";
    latchWelcome.textContent = isAdmin ? "管理员模式" : "只读模式";
    if (isAdmin) {
        // Show all tabs; default to proxies
        latchTabProxies.hidden = false;
        latchTabRules.hidden = false;
        latchProfileAdminGrid.hidden = false;
        latchProfileUserView.hidden = true;
        switchTab("proxies");
        await loadAdminData();
        wireAdminEvents();
    }
    else {
        // Hide proxy/rule tabs, jump straight to profiles (read-only)
        latchTabProxies.hidden = true;
        latchTabRules.hidden = true;
        latchProfileAdminGrid.hidden = true;
        latchProfileUserView.hidden = false;
        switchTab("profiles");
        await loadUserData();
    }
}
// ---------------------------------------------------------------------------
// Admin event handlers
// ---------------------------------------------------------------------------
function wireAdminEvents() {
    // Sub-tab switching
    latchSubtabBtns.forEach((btn) => {
        btn.addEventListener("click", () => switchTab(btn.dataset.latchTab || "proxies"));
    });
    // — Proxy —
    latchProxyResetBtn.addEventListener("click", resetProxyForm);
    latchProxySubmitBtn.addEventListener("click", async () => {
        const name = latchProxyNameInput.value.trim();
        const type = latchProxyTypeSelect.value;
        const raw = latchProxyConfigInput.value.trim();
        if (!name) {
            setStatus(latchProxyStatus, "请填写代理名称", "error");
            return;
        }
        let config = {};
        if (raw) {
            try {
                config = JSON.parse(raw);
            }
            catch {
                setStatus(latchProxyStatus, "配置 JSON 格式有误", "error");
                return;
            }
        }
        latchProxySubmitBtn.disabled = true;
        setStatus(latchProxyStatus, editingLatchProxyGroupId ? "正在更新…" : "正在创建…");
        try {
            const { response, data } = editingLatchProxyGroupId
                ? await updateLatchProxy(editingLatchProxyGroupId, { name, type, config })
                : await createLatchProxy({ name, type, config });
            if (!response.ok) {
                setStatus(latchProxyStatus, data.error || "保存失败", "error");
                return;
            }
            setStatus(latchProxyStatus, data.message || "已保存", "success");
            resetProxyForm();
            await loadAdminData();
        }
        catch {
            setStatus(latchProxyStatus, "网络错误，请重试", "error");
        }
        finally {
            latchProxySubmitBtn.disabled = false;
        }
    });
    latchProxyList.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn)
            return;
        const gid = btn.closest("[data-latch-proxy-gid]")?.dataset.latchProxyGid || "";
        const proxy = currentLatchProxies.find((p) => p.group_id === gid);
        if (!proxy)
            return;
        const action = btn.dataset.action;
        if (action === "edit") {
            fillProxyForm(proxy);
            latchProxyNameInput.focus();
            return;
        }
        if (action === "versions") {
            try {
                const { response, data } = await fetchLatchProxyVersions(gid);
                if (!response.ok) {
                    setStatus(latchProxyStatus, data.error || "获取失败", "error");
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
                    setStatus(latchProxyStatus, "版本未变", "default");
                    return;
                }
                const { response: r2, data: d2 } = await rollbackLatchProxy(gid, ver);
                if (!r2.ok) {
                    setStatus(latchProxyStatus, d2.error || "回滚失败", "error");
                    return;
                }
                setStatus(latchProxyStatus, d2.message || "回滚成功", "success");
                await loadAdminData();
            }
            catch {
                setStatus(latchProxyStatus, "网络错误，请重试", "error");
            }
            return;
        }
        if (action === "delete") {
            if (!window.confirm(`确定删除代理 "${proxy.name}" 的所有版本吗？`))
                return;
            try {
                const { response, data } = await removeLatchProxy(gid);
                if (!response.ok) {
                    setStatus(latchProxyStatus, data.error || "删除失败", "error");
                    return;
                }
                if (editingLatchProxyGroupId === gid)
                    resetProxyForm();
                setStatus(latchProxyStatus, data.message || "已删除", "success");
                await loadAdminData();
            }
            catch {
                setStatus(latchProxyStatus, "网络错误，请重试", "error");
            }
        }
    });
    // — Rule source toggle —
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
    latchRuleResetBtn.addEventListener("click", resetRuleForm);
    latchRuleSubmitBtn.addEventListener("click", async () => {
        const name = latchRuleNameInput.value.trim();
        const content = latchRuleContentInput.value;
        if (!name) {
            setStatus(latchRuleStatus, "请填写规则名称", "error");
            return;
        }
        latchRuleSubmitBtn.disabled = true;
        setStatus(latchRuleStatus, editingLatchRuleGroupId ? "正在更新…" : "正在创建…");
        try {
            const { response, data } = editingLatchRuleGroupId
                ? await updateLatchRule(editingLatchRuleGroupId, { name, content })
                : await createLatchRule({ name, content });
            if (!response.ok) {
                setStatus(latchRuleStatus, data.error || "保存失败", "error");
                return;
            }
            setStatus(latchRuleStatus, data.message || "已保存", "success");
            resetRuleForm();
            await loadAdminData();
        }
        catch {
            setStatus(latchRuleStatus, "网络错误，请重试", "error");
        }
        finally {
            latchRuleSubmitBtn.disabled = false;
        }
    });
    latchRuleUploadBtn.addEventListener("click", async () => {
        const name = latchRuleNameInput.value.trim();
        const file = latchRuleFileInput.files?.[0];
        if (!file) {
            setStatus(latchRuleStatus, "请先选择文件", "error");
            return;
        }
        const fd = new FormData();
        if (name)
            fd.append("name", name);
        fd.append("file", file);
        latchRuleUploadBtn.disabled = true;
        setStatus(latchRuleStatus, "正在上传…");
        try {
            const { response, data } = editingLatchRuleGroupId
                ? await uploadLatchRuleFile(editingLatchRuleGroupId, fd)
                : await createLatchRuleFromFile(fd);
            if (!response.ok) {
                setStatus(latchRuleStatus, data.error || "上传失败", "error");
                return;
            }
            setStatus(latchRuleStatus, data.message || "上传成功", "success");
            resetRuleForm();
            await loadAdminData();
        }
        catch {
            setStatus(latchRuleStatus, "网络错误，请重试", "error");
        }
        finally {
            latchRuleUploadBtn.disabled = false;
        }
    });
    latchRuleList.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn)
            return;
        const gid = btn.closest("[data-latch-rule-gid]")?.dataset.latchRuleGid || "";
        const rule = currentLatchRules.find((r) => r.group_id === gid);
        if (!rule)
            return;
        const action = btn.dataset.action;
        if (action === "edit") {
            fillRuleForm(rule);
            latchRuleNameInput.focus();
            return;
        }
        if (action === "versions") {
            try {
                const { response, data } = await fetchLatchRuleVersions(gid);
                if (!response.ok) {
                    setStatus(latchRuleStatus, data.error || "获取失败", "error");
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
                    setStatus(latchRuleStatus, "版本未变", "default");
                    return;
                }
                const { response: r2, data: d2 } = await rollbackLatchRule(gid, ver);
                if (!r2.ok) {
                    setStatus(latchRuleStatus, d2.error || "回滚失败", "error");
                    return;
                }
                setStatus(latchRuleStatus, d2.message || "回滚成功", "success");
                await loadAdminData();
            }
            catch {
                setStatus(latchRuleStatus, "网络错误，请重试", "error");
            }
            return;
        }
        if (action === "delete") {
            if (!window.confirm(`确定删除规则 "${rule.name}" 的所有版本吗？`))
                return;
            try {
                const { response, data } = await removeLatchRule(gid);
                if (!response.ok) {
                    setStatus(latchRuleStatus, data.error || "删除失败", "error");
                    return;
                }
                if (editingLatchRuleGroupId === gid)
                    resetRuleForm();
                setStatus(latchRuleStatus, data.message || "已删除", "success");
                await loadAdminData();
            }
            catch {
                setStatus(latchRuleStatus, "网络错误，请重试", "error");
            }
        }
    });
    // — Profile —
    latchProfileResetBtn.addEventListener("click", resetProfileForm);
    latchProfileSubmitBtn.addEventListener("click", async () => {
        const name = latchProfileNameInput.value.trim();
        if (!name) {
            setStatus(latchProfileStatus, "请填写配置名称", "error");
            return;
        }
        const proxyGroupIds = Array.from(latchProfileProxyCheckboxes.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
        const ruleRadio = latchProfileRuleRadios.querySelector("input[type=radio]:checked");
        const payload = {
            name,
            description: latchProfileDescInput.value.trim(),
            proxy_group_ids: proxyGroupIds,
            rule_group_id: ruleRadio?.value || "",
            enabled: latchProfileEnabledInput.checked,
            shareable: latchProfileShareableInput.checked,
        };
        latchProfileSubmitBtn.disabled = true;
        setStatus(latchProfileStatus, editingLatchProfileId ? "正在更新…" : "正在创建…");
        try {
            const { response, data } = editingLatchProfileId
                ? await updateLatchProfile(editingLatchProfileId, payload)
                : await createLatchProfile(payload);
            if (!response.ok) {
                setStatus(latchProfileStatus, data.error || "保存失败", "error");
                return;
            }
            setStatus(latchProfileStatus, data.message || "已保存", "success");
            resetProfileForm();
            await loadAdminData();
        }
        catch {
            setStatus(latchProfileStatus, "网络错误，请重试", "error");
        }
        finally {
            latchProfileSubmitBtn.disabled = false;
        }
    });
    latchProfileList.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-action]");
        if (!btn)
            return;
        const id = btn.closest("[data-latch-profile-id]")?.dataset.latchProfileId || "";
        const prof = currentLatchProfiles.find((p) => p.id === id);
        if (!prof)
            return;
        const action = btn.dataset.action;
        if (action === "edit") {
            fillProfileForm(prof);
            latchProfileNameInput.focus();
            return;
        }
        if (action === "delete") {
            if (!window.confirm(`确定删除配置 "${prof.name}" 吗？`))
                return;
            try {
                const { response, data } = await removeLatchProfile(id);
                if (!response.ok) {
                    setStatus(latchProfileStatus, data.error || "删除失败", "error");
                    return;
                }
                if (editingLatchProfileId === id)
                    resetProfileForm();
                setStatus(latchProfileStatus, data.message || "已删除", "success");
                await loadAdminData();
            }
            catch {
                setStatus(latchProfileStatus, "网络错误，请重试", "error");
            }
        }
    });
}
init();
