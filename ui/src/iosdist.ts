// iOS distribution page entrypoint.
//
// Three responsibilities:
//   1. Owner-scoped CRUD over /api/iosdist/apps + versions.
//   2. IPA upload (multipart) with simple progress feedback.
//   3. On-demand short-lived install token + manifest.plist URL + QR.
//
// The signing pipeline lands later (M2). This page only handles already
// signed Ad-hoc / Enterprise IPAs and stores them via AttachmentStorage.

import {
  createIOSApp,
  createIOSInstallToken,
  deleteIOSApp,
  deleteIOSASCConfig,
  deleteIOSCertificate,
  deleteIOSProfile,
  deleteIOSVersion,
  fetchIOSASCApps,
  fetchIOSASCBetaGroups,
  fetchIOSASCConfigStatus,
  fetchIOSAppDetail,
  fetchIOSAppTestRequests,
  fetchIOSApps,
  fetchIOSCertificates,
  fetchIOSProfiles,
  inviteIOSAppTester,
  syncIOSAppFromASC,
  updateIOSAppASCBinding,
  updateIOSAppTestFlight,
  updateIOSAppVisibility,
  upsertIOSASCConfig,
  uploadIOSAppIcon,
  uploadIOSCertificate,
  uploadIOSProfile,
  uploadIOSVersion,
} from "./api/iosdist.js";
import { fetchCurrentUser, logout } from "./api/session.js";
import { byId } from "./lib/dom.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import type {
  IOSApp,
  IOSASCApp,
  IOSASCBetaGroup,
  IOSCertificate,
  IOSDistType,
  IOSInstallTokenResponse,
  IOSProfile,
  IOSTestRequest,
  IOSVersion,
} from "./types/iosdist.js";

initStoredTheme();
bindThemeSync();

declare const QRCode: new (
  el: HTMLElement,
  opts: { text: string; width?: number; height?: number; correctLevel?: number },
) => unknown;

const appListEl = byId<HTMLElement>("iosAppList");
const newAppBtn = byId<HTMLButtonElement>("iosNewAppBtn");
const detailEl = byId<HTMLElement>("iosDetail");
const emptyEl = byId<HTMLElement>("iosEmpty");
const appPanelEl = byId<HTMLElement>("iosAppPanel");
const appNameEl = byId<HTMLElement>("iosAppName");
const appBundleEl = byId<HTMLElement>("iosAppBundle");
const appMetaEl = byId<HTMLElement>("iosAppMeta");
const versionListEl = byId<HTMLElement>("iosVersionList");
const deleteAppBtn = byId<HTMLButtonElement>("iosDeleteAppBtn");

// Icon + TestFlight controls.
const appIconImg = byId<HTMLImageElement>("iosAppIcon");
const appIconPlaceholder = byId<HTMLElement>("iosAppIconPlaceholder");
const appIconFileInput = byId<HTMLInputElement>("iosAppIconFile");
const appIconChangeBtn = byId<HTMLButtonElement>("iosAppIconChangeBtn");
const appIconSrcBadge = byId<HTMLElement>("iosAppIconSrcBadge");
const tfURLInput = byId<HTMLInputElement>("iosTestFlightURLInput");
const tfSaveBtn = byId<HTMLButtonElement>("iosTestFlightSaveBtn");
const tfOpenBtn = byId<HTMLAnchorElement>("iosTestFlightOpenBtn");
const tfStatus = byId<HTMLElement>("iosTestFlightStatus");

// Public share + test-request inbox controls.
const publicToggle = byId<HTMLInputElement>("iosPublicToggle");
const publicQR = byId<HTMLElement>("iosPublicQR");
const publicURL = byId<HTMLElement>("iosPublicURL");
const publicOpenBtn = byId<HTMLAnchorElement>("iosPublicOpenBtn");
const publicCopyBtn = byId<HTMLButtonElement>("iosPublicCopyBtn");
const publicStatus = byId<HTMLElement>("iosPublicStatus");
const testRequestList = byId<HTMLElement>("iosTestRequestList");
const testRequestRefreshBtn = byId<HTMLButtonElement>("iosTestReqRefreshBtn");

// ASC integration controls.
const ascConfigBtn = byId<HTMLButtonElement>("iosASCConfigBtn");
const ascDeleteBtn = byId<HTMLButtonElement>("iosASCDeleteBtn");
const ascConfigStatus = byId<HTMLElement>("iosASCConfigStatus");
const ascBindingArea = byId<HTMLElement>("iosASCBindingArea");
const ascNotConfiguredHint = byId<HTMLElement>("iosASCNotConfiguredHint");
const ascAppSelect = byId<HTMLSelectElement>("iosASCAppSelect");
const ascBetaGroupSelect = byId<HTMLSelectElement>("iosASCBetaGroupSelect");
const ascBindingSaveBtn = byId<HTMLButtonElement>("iosASCBindingSaveBtn");
const ascRefreshBtn = byId<HTMLButtonElement>("iosASCRefreshBtn");
const ascSyncMetaBtn = byId<HTMLButtonElement>("iosASCSyncMetaBtn");
const ascBindingStatus = byId<HTMLElement>("iosASCBindingStatus");

const ascInviteArea = byId<HTMLElement>("iosASCInviteArea");
const inviteEmailInput = byId<HTMLInputElement>("iosInviteEmail");
const inviteFirstInput = byId<HTMLInputElement>("iosInviteFirst");
const inviteLastInput = byId<HTMLInputElement>("iosInviteLast");
const inviteSendBtn = byId<HTMLButtonElement>("iosInviteSendBtn");
const inviteStatus = byId<HTMLElement>("iosInviteStatus");

const ascModal = byId<HTMLElement>("iosASCModal");
const ascModalCloseBtn = byId<HTMLButtonElement>("iosASCModalCloseBtn");
const ascForm = byId<HTMLFormElement>("iosASCForm");
const ascIssuerInput = byId<HTMLInputElement>("iosASCIssuerInput");
const ascKeyIDInput = byId<HTMLInputElement>("iosASCKeyIDInput");
const ascP8Input = byId<HTMLInputElement>("iosASCP8Input");
const ascFormStatus = byId<HTMLElement>("iosASCFormStatus");

let ascConfigured = false;
let ascAppCache: IOSASCApp[] = [];
let ascBetaGroupCache: IOSASCBetaGroup[] = [];


const uploadForm = byId<HTMLFormElement>("iosUploadForm");
const uploadFile = byId<HTMLInputElement>("iosUploadFile");
const uploadVersion = byId<HTMLInputElement>("iosUploadVersion");
const uploadBuild = byId<HTMLInputElement>("iosUploadBuild");
const uploadDistType = byId<HTMLSelectElement>("iosUploadDistType");
const uploadNotes = byId<HTMLTextAreaElement>("iosUploadNotes");
const uploadStatus = byId<HTMLElement>("iosUploadStatus");
const uploadSubmit = byId<HTMLButtonElement>("iosUploadSubmit");

// Resource center (certs + profiles)
const certListEl = byId<HTMLElement>("iosCertList");
const profileListEl = byId<HTMLElement>("iosProfileList");
const resourceWarningEl = byId<HTMLElement>("iosResourceWarning");
const openCertModalBtn = byId<HTMLButtonElement>("iosOpenCertModalBtn");
const openProfileModalBtn = byId<HTMLButtonElement>("iosOpenProfileModalBtn");

const certModal = byId<HTMLElement>("iosCertModal");
const certModalCloseBtn = byId<HTMLButtonElement>("iosCertModalCloseBtn");
const certForm = byId<HTMLFormElement>("iosCertForm");
const certNameInput = byId<HTMLInputElement>("iosCertName");
const certKindInput = byId<HTMLSelectElement>("iosCertKind");
const certFileInput = byId<HTMLInputElement>("iosCertFile");
const certPasswordInput = byId<HTMLInputElement>("iosCertPassword");
const certTeamInput = byId<HTMLInputElement>("iosCertTeamID");
const certCommonInput = byId<HTMLInputElement>("iosCertCommonName");
const certNotesInput = byId<HTMLTextAreaElement>("iosCertNotes");
const certFormStatus = byId<HTMLElement>("iosCertFormStatus");

const profileModal = byId<HTMLElement>("iosProfileModal");
const profileModalCloseBtn = byId<HTMLButtonElement>("iosProfileModalCloseBtn");
const profileForm = byId<HTMLFormElement>("iosProfileForm");
const profileNameInput = byId<HTMLInputElement>("iosProfileName");
const profileKindInput = byId<HTMLSelectElement>("iosProfileKind");
const profileFileInput = byId<HTMLInputElement>("iosProfileFile");
const profileAppIDInput = byId<HTMLInputElement>("iosProfileAppID");
const profileTeamInput = byId<HTMLInputElement>("iosProfileTeamID");
const profileNotesInput = byId<HTMLTextAreaElement>("iosProfileNotes");
const profileFormStatus = byId<HTMLElement>("iosProfileFormStatus");

const installCard = byId<HTMLElement>("iosInstallCard");
const installQR = byId<HTMLElement>("iosInstallQR");
const installURL = byId<HTMLElement>("iosInstallURL");
const installOpenBtn = byId<HTMLAnchorElement>("iosInstallOpenBtn");
const installCopyBtn = byId<HTMLButtonElement>("iosInstallCopyBtn");
const installExpiry = byId<HTMLElement>("iosInstallExpiry");

const appModal = byId<HTMLElement>("iosAppModal");
const appModalCloseBtn = byId<HTMLButtonElement>("iosAppModalCloseBtn");
const appForm = byId<HTMLFormElement>("iosAppForm");
const appNameInput = byId<HTMLInputElement>("iosAppNameInput");
const appBundleInput = byId<HTMLInputElement>("iosAppBundleInput");
const appDescInput = byId<HTMLTextAreaElement>("iosAppDescInput");
const appFormStatus = byId<HTMLElement>("iosAppFormStatus");

let apps: IOSApp[] = [];
let activeAppID: number | null = null;
let activeVersions: IOSVersion[] = [];
let certificates: IOSCertificate[] = [];
let profiles: IOSProfile[] = [];

const distTypeLabels: Record<IOSDistType, string> = {
  ad_hoc: "Ad-hoc",
  enterprise: "Enterprise",
  development: "Development",
  app_store: "App Store",
};

function isOTAInstallable(t: IOSDistType): boolean {
  return t === "ad_hoc" || t === "enterprise" || t === "development";
}

// renderExpiryPill returns inline HTML for a colored urgency pill.
// Buckets: red ≤7 days, amber ≤30 days, green >30 days, grey for missing.
function renderExpiryPill(iso: string | null | undefined): string {
  if (!iso) {
    return `<span class="settings-value-pill" style="opacity:0.6;">无过期信息</span>`;
  }
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) {
    return `<span class="settings-value-pill" style="opacity:0.6;">${escapeHTML(iso)}</span>`;
  }
  const daysLeft = Math.round((target.getTime() - Date.now()) / 86_400_000);
  let bg = "#e6f4ea";
  let color = "#0b6b2c";
  let label = `剩 ${daysLeft} 天`;
  if (daysLeft <= 0) {
    bg = "#fde2e1";
    color = "#a30000";
    label = `已过期 ${-daysLeft} 天`;
  } else if (daysLeft <= 7) {
    bg = "#fde2e1";
    color = "#a30000";
  } else if (daysLeft <= 30) {
    bg = "#fff5cc";
    color = "#7a5c00";
  }
  return `<span class="settings-value-pill" style="background:${bg};color:${color};" title="${escapeHTML(target.toLocaleString())}">${label}</span>`;
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function fmtTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function renderAppList(): void {
  if (apps.length === 0) {
    appListEl.innerHTML = `<div class="chat-empty">还没有应用。点击右上方「＋ 新建应用」开始。</div>`;
    return;
  }
  appListEl.innerHTML = "";
  apps.forEach((a) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "video-studio-project-card";
    if (a.id === activeAppID) card.classList.add("active");
    const iconHTML = a.icon_url
      ? `<img src="${escapeHTML(a.icon_url)}" alt="" style="width:36px; height:36px; border-radius:8px; object-fit:cover; flex-shrink:0;" />`
      : `<div style="width:36px; height:36px; border-radius:8px; background:linear-gradient(135deg,#e9e9ef,#cfd0d6); display:flex; align-items:center; justify-content:center; font-size:16px; color:#888; flex-shrink:0;">📱</div>`;
    card.style.display = "flex";
    card.style.alignItems = "center";
    card.style.gap = "10px";
    card.innerHTML = `
      ${iconHTML}
      <div style="flex:1; min-width:0; text-align:left;">
        <div class="video-studio-project-card-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(a.name)}</div>
        <div class="video-studio-project-card-meta" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHTML(a.bundle_id)}</div>
      </div>
    `;
    card.addEventListener("click", () => void openApp(a.id));
    appListEl.appendChild(card);
  });
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAppDetail(): void {
  const app = apps.find((a) => a.id === activeAppID);
  if (!app) {
    appPanelEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  appPanelEl.hidden = false;
  appNameEl.textContent = app.name;
  appBundleEl.textContent = app.bundle_id;
  appMetaEl.textContent = app.description
    ? app.description
    : `创建于 ${fmtTime(app.created_at)}`;

  // Icon: prefer img tag, fall back to placeholder block.
  if (app.icon_url) {
    appIconImg.src = app.icon_url;
    appIconImg.style.display = "block";
    appIconPlaceholder.style.display = "none";
  } else {
    appIconImg.removeAttribute("src");
    appIconImg.style.display = "none";
    appIconPlaceholder.style.display = "flex";
  }
  if (app.icon_source === "ipa") {
    appIconSrcBadge.hidden = false;
    appIconSrcBadge.textContent = "图标自 IPA 提取";
  } else if (app.icon_source === "manual") {
    appIconSrcBadge.hidden = false;
    appIconSrcBadge.textContent = "手动上传";
  } else {
    appIconSrcBadge.hidden = true;
  }

  // TestFlight URL: keep input synced + toggle the open button.
  tfURLInput.value = app.testflight_url ?? "";
  tfStatus.textContent = "";
  if (app.testflight_url) {
    tfOpenBtn.hidden = false;
    tfOpenBtn.href = app.testflight_url;
  } else {
    tfOpenBtn.hidden = true;
    tfOpenBtn.removeAttribute("href");
  }

  // ASC binding area: only show when account-level key is configured.
  // The "no key" hint plus the binding form are mutually exclusive — at
  // any given time exactly one is visible inside the card.
  ascBindingArea.hidden = !ascConfigured;
  ascNotConfiguredHint.hidden = ascConfigured;
  ascInviteArea.hidden = !(ascConfigured && app.asc_beta_group_id);
  if (ascConfigured) {
    populateASCAppSelect(app.asc_app_id);
    populateASCBetaGroupSelect(app.asc_beta_group_id);
  }
  inviteStatus.textContent = "";
  ascBindingStatus.textContent = "";

  // Public share section: URL + QR + visibility toggle.
  const shareURL = `${window.location.origin}/iosdist/share/${app.public_slug}`;
  publicToggle.checked = !!app.is_public;
  publicURL.textContent = shareURL;
  publicOpenBtn.href = shareURL;
  publicStatus.textContent = "";
  publicQR.innerHTML = "";
  if (typeof QRCode === "function" && app.public_slug) {
    new QRCode(publicQR, { text: shareURL, width: 140, height: 140, correctLevel: 2 });
  }

  // Pull test requests for this app every time the user switches to it.
  void loadTestRequests();

  if (activeVersions.length === 0) {
    versionListEl.innerHTML = `<li class="chat-empty">还没有版本，请上传 IPA。</li>`;
    return;
  }
  versionListEl.innerHTML = "";
  activeVersions.forEach((v) => {
    const li = document.createElement("li");
    li.style.display = "flex";
    li.style.justifyContent = "space-between";
    li.style.alignItems = "flex-start";
    li.style.gap = "12px";
    li.style.padding = "12px 0";
    li.style.borderBottom = "1px solid var(--border, rgba(0,0,0,0.06))";
    const distType = (v.distribution_type || "ad_hoc") as IOSDistType;
    const installable = isOTAInstallable(distType);

    // Compose the IPA-derived metadata strip when the parser actually
    // returned something. We compare the IPA's CFBundleShortVersionString
    // to the user-entered version and amber-flag mismatches — common
    // when someone bumps the form value after picking the file.
    const ipaPills: string[] = [];
    if (v.ipa_display_name) ipaPills.push(`<span class="settings-value-pill">${escapeHTML(v.ipa_display_name)}</span>`);
    if (v.ipa_bundle_id) ipaPills.push(`<span class="settings-value-pill" title="IPA 内部 bundle id">${escapeHTML(v.ipa_bundle_id)}</span>`);
    if (v.ipa_min_os) ipaPills.push(`<span class="settings-value-pill">iOS ${escapeHTML(v.ipa_min_os)}+</span>`);
    if (v.ipa_has_embedded_profile) ipaPills.push(`<span class="settings-value-pill" title="IPA 内已嵌入 mobileprovision">已嵌签名</span>`);

    let versionMismatchHTML = "";
    if (v.ipa_short_version && v.version && v.ipa_short_version !== v.version) {
      versionMismatchHTML = `<span class="settings-value-pill" style="background:#fff5cc;color:#7a5c00;" title="表单填的版本号与 IPA 内 CFBundleShortVersionString 不一致">⚠ IPA: ${escapeHTML(v.ipa_short_version)}</span>`;
    }

    li.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-weight:600; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">v${escapeHTML(v.version)}${v.build_number ? ` <span class="settings-value-pill">build ${escapeHTML(v.build_number)}</span>` : ""} <span class="settings-value-pill">${escapeHTML(distTypeLabels[distType] ?? distType)}</span> ${versionMismatchHTML}</div>
        <div class="settings-info-meta" style="margin-top:4px;">
          ${escapeHTML(v.ipa_filename || "ipa")} · ${fmtSize(v.ipa_size)} · ${fmtTime(v.created_at)}
        </div>
        ${ipaPills.length > 0 ? `<div style="margin-top:6px; display:flex; flex-wrap:wrap; gap:6px;">${ipaPills.join("")}</div>` : ""}
        ${v.release_notes ? `<div class="drawer-help" style="margin-top:6px;">${escapeHTML(v.release_notes)}</div>` : ""}
      </div>
      <div class="inline-actions" style="flex-shrink:0; align-items:center;">
        ${installable
          ? `<button class="btn-inline btn-secondary" data-action="install" data-version="${v.id}">生成安装链接</button>`
          : (app?.testflight_url
              ? `<a class="btn-inline btn-secondary" target="_blank" rel="noopener" href="${escapeHTML(app.testflight_url)}" title="通过 TestFlight 安装">TestFlight 邀请</a>`
              : `<span class="settings-value-pill" title="App Store 类型 IPA 必须通过 App Store Connect 分发">OTA 不可装</span>`
            )
        }
        <button class="btn-inline btn-secondary" data-action="delete" data-version="${v.id}">删除</button>
      </div>
    `;
    versionListEl.appendChild(li);
  });

  versionListEl.querySelectorAll<HTMLButtonElement>("button[data-action='install']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.version);
      if (!Number.isFinite(id) || !activeAppID) return;
      btn.disabled = true;
      btn.textContent = "生成中...";
      try {
        await issueInstallLink(activeAppID, id);
      } catch (err) {
        alert("生成安装链接失败：" + describeError(err));
      } finally {
        btn.disabled = false;
        btn.textContent = "生成安装链接";
      }
    });
  });
  versionListEl.querySelectorAll<HTMLButtonElement>("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.version);
      if (!Number.isFinite(id) || !activeAppID) return;
      if (!confirm("确认删除该版本？已签发的安装链接也会失效。")) return;
      try {
        const res = await deleteIOSVersion(activeAppID, id);
        if (!res.ok) throw new Error("delete failed");
        await reloadActiveApp();
      } catch (err) {
        alert("删除失败：" + describeError(err));
      }
    });
  });
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "未知错误";
}

async function loadApps(): Promise<void> {
  try {
    const { data } = await fetchIOSApps();
    apps = data.apps ?? [];
  } catch (err) {
    apps = [];
  }
  renderAppList();
}

async function openApp(id: number): Promise<void> {
  activeAppID = id;
  installCard.hidden = true;
  installQR.innerHTML = "";
  uploadStatus.textContent = "";
  await reloadActiveApp();
  renderAppList();
  // Auto-refresh ASC lists when switching apps so the dropdowns are
  // never empty when they should have data. Fire-and-forget — the
  // refresh re-renders the binding selects on completion.
  if (ascConfigured) {
    void refreshASCLists();
  }
}

async function reloadActiveApp(): Promise<void> {
  if (!activeAppID) {
    activeVersions = [];
    renderAppDetail();
    return;
  }
  try {
    const { data } = await fetchIOSAppDetail(activeAppID);
    // Sync the cached app entry too so name edits stay fresh.
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    activeVersions = data.versions ?? [];
  } catch (err) {
    activeVersions = [];
  }
  renderAppDetail();
}

async function issueInstallLink(appID: number, versionID: number): Promise<void> {
  const { response, data } = await createIOSInstallToken(appID, versionID);
  if (!response.ok) throw new Error("token request failed");
  showInstallToken(data);
}

function showInstallToken(t: IOSInstallTokenResponse): void {
  installCard.hidden = false;
  installURL.textContent = t.install_url;
  installOpenBtn.href = t.install_url;
  installExpiry.textContent = `链接有效期至 ${fmtTime(t.expires_at)}（约 ${(
    (new Date(t.expires_at).getTime() - Date.now()) /
    36e5
  ).toFixed(0)} 小时）`;
  installQR.innerHTML = "";
  // QRCode is loaded via <script> tag in iosdist.html; guard gracefully.
  if (typeof QRCode === "function") {
    new QRCode(installQR, {
      text: t.install_url,
      width: 180,
      height: 180,
      correctLevel: 2,
    });
  } else {
    installQR.textContent = "(二维码库未加载)";
  }
  installCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

uploadForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  if (!activeAppID) return;
  const file = uploadFile.files?.[0];
  if (!file) {
    uploadStatus.textContent = "请选择 IPA 文件";
    return;
  }
  const version = uploadVersion.value.trim();
  uploadSubmit.disabled = true;
  uploadStatus.textContent = `正在上传 ${(file.size / (1024 * 1024)).toFixed(1)} MB...`;
  try {
    const { response, data } = await uploadIOSVersion(activeAppID, {
      file,
      // Server falls back to IPA's CFBundleShortVersionString when blank;
      // we just send "0" as a sentinel so the existing required-field
      // check on the backend passes — the server-side IPA parser then
      // rewrites it.
      version: version || "0",
      build: uploadBuild.value.trim() || undefined,
      notes: uploadNotes.value.trim() || undefined,
      distribution_type: (uploadDistType.value || "ad_hoc") as IOSDistType,
    });
    if (!response.ok) throw new Error("upload failed");
    uploadStatus.textContent = `上传完成：v${data.version.version}`;
    uploadForm.reset();
    await reloadActiveApp();
  } catch (err) {
    uploadStatus.textContent = "上传失败：" + describeError(err);
  } finally {
    uploadSubmit.disabled = false;
  }
});

// Icon upload: pencil button triggers a hidden file input. After
// upload we refresh the active app entry and re-render the header.
appIconChangeBtn.addEventListener("click", () => appIconFileInput.click());
appIconFileInput.addEventListener("change", async () => {
  if (!activeAppID) return;
  const file = appIconFileInput.files?.[0];
  if (!file) return;
  try {
    const { response, data } = await uploadIOSAppIcon(activeAppID, file);
    if (!response.ok) throw new Error("upload failed");
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    renderAppList();
    renderAppDetail();
  } catch (err) {
    alert("图标上传失败：" + describeError(err));
  } finally {
    appIconFileInput.value = "";
  }
});

// TestFlight URL save. Empty string clears the binding.
tfSaveBtn.addEventListener("click", async () => {
  if (!activeAppID) return;
  tfStatus.textContent = "保存中...";
  try {
    const { response, data } = await updateIOSAppTestFlight(activeAppID, tfURLInput.value.trim());
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "保存失败";
      throw new Error(err);
    }
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    tfStatus.textContent = data.app.testflight_url ? "已保存" : "已清除";
    renderAppDetail();
    renderAppList();
  } catch (err) {
    tfStatus.textContent = "保存失败：" + describeError(err);
  }
});

deleteAppBtn.addEventListener("click", async () => {
  if (!activeAppID) return;
  if (!confirm("删除该应用会一并删除所有版本与安装链接，确认继续？")) return;
  try {
    const res = await deleteIOSApp(activeAppID);
    if (!res.ok) throw new Error("delete failed");
    activeAppID = null;
    activeVersions = [];
    await loadApps();
    renderAppDetail();
  } catch (err) {
    alert("删除失败：" + describeError(err));
  }
});

// ---- New app modal --------------------------------------------------------

// All four modals on this page (new app, cert, profile, ASC) follow the
// shared dashboard convention: toggle the `.open` class on the .modal
// element + flip aria-hidden + flip body.modal-open so background scroll
// is locked. styles.css gates the actual `display:flex` on `.modal.open`.
function setModalOpen(el: HTMLElement, open: boolean): void {
  el.classList.toggle("open", open);
  el.setAttribute("aria-hidden", open ? "false" : "true");
  document.body.classList.toggle("modal-open", open);
}

function openAppModal(): void {
  setModalOpen(appModal, true);
  appFormStatus.textContent = "";
  appForm.reset();
  appNameInput.focus();
}
function closeAppModal(): void {
  setModalOpen(appModal, false);
}

newAppBtn.addEventListener("click", openAppModal);
appModalCloseBtn.addEventListener("click", closeAppModal);
appModal.querySelector(".modal-backdrop")?.addEventListener("click", closeAppModal);

appForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = appNameInput.value.trim();
  const bundleID = appBundleInput.value.trim();
  if (!name || !bundleID) {
    appFormStatus.textContent = "请填写应用名和 Bundle ID";
    return;
  }
  appFormStatus.textContent = "创建中...";
  try {
    const { response, data } = await createIOSApp({
      name,
      bundle_id: bundleID,
      description: appDescInput.value.trim() || undefined,
    });
    if (!response.ok) throw new Error("create failed");
    apps = [data.app, ...apps];
    activeAppID = data.app.id;
    activeVersions = [];
    closeAppModal();
    renderAppList();
    renderAppDetail();
  } catch (err) {
    appFormStatus.textContent = "创建失败：" + describeError(err);
  }
});

// ---- Resource center ------------------------------------------------------

function renderCertList(): void {
  if (certificates.length === 0) {
    certListEl.innerHTML = `<li class="chat-empty">还没有证书</li>`;
    return;
  }
  certListEl.innerHTML = "";
  certificates.forEach((c) => {
    const li = document.createElement("li");
    li.style.padding = "10px 0";
    li.style.borderBottom = "1px solid var(--border, rgba(0,0,0,0.06))";
    const lockBadge = c.has_password
      ? c.password_encrypted
        ? `<span class="settings-value-pill" title="密码已用 AES-256-GCM 加密">🔒 已加密</span>`
        : `<span class="settings-value-pill" title="服务端未配置 IOSDIST_RESOURCE_KEY，密码以明文存储" style="color:#a86a00;">⚠ 明文</span>`
      : `<span class="settings-value-pill">无密码</span>`;
    li.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">${escapeHTML(c.name)} <span class="settings-value-pill">${escapeHTML(c.kind)}</span> ${lockBadge} ${renderExpiryPill(c.expires_at)}</div>
          <div class="settings-info-meta" style="margin-top:4px;">${escapeHTML(c.file_filename)} · ${fmtSize(c.file_size)}</div>
          ${c.team_id || c.common_name ? `<div class="drawer-help" style="margin-top:4px;">${escapeHTML([c.team_id, c.common_name].filter(Boolean).join(" · "))}</div>` : ""}
        </div>
        <button class="btn-inline btn-secondary" data-cert="${c.id}">删除</button>
      </div>
    `;
    certListEl.appendChild(li);
  });
  certListEl.querySelectorAll<HTMLButtonElement>("button[data-cert]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.cert);
      if (!confirm("确认删除该证书？")) return;
      try {
        const res = await deleteIOSCertificate(id);
        if (!res.ok) throw new Error("delete failed");
        await loadCertificates();
      } catch (err) {
        alert("删除失败：" + describeError(err));
      }
    });
  });
}

function renderProfileList(): void {
  if (profiles.length === 0) {
    profileListEl.innerHTML = `<li class="chat-empty">还没有 Profile</li>`;
    return;
  }
  profileListEl.innerHTML = "";
  profiles.forEach((p) => {
    const li = document.createElement("li");
    li.style.padding = "10px 0";
    li.style.borderBottom = "1px solid var(--border, rgba(0,0,0,0.06))";
    const udidLabel = p.udid_count > 0 ? ` · ${p.udid_count} UDID` : "";
    li.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; display:flex; flex-wrap:wrap; gap:6px; align-items:center;">${escapeHTML(p.name)} <span class="settings-value-pill">${escapeHTML(distTypeLabels[p.kind] ?? p.kind)}</span> ${renderExpiryPill(p.expires_at)}</div>
          <div class="settings-info-meta" style="margin-top:4px;">${escapeHTML(p.file_filename)} · ${fmtSize(p.file_size)}${udidLabel}</div>
          ${p.app_id || p.team_id ? `<div class="drawer-help" style="margin-top:4px;">${escapeHTML([p.app_id, p.team_id].filter(Boolean).join(" · "))}</div>` : ""}
        </div>
        <button class="btn-inline btn-secondary" data-profile="${p.id}">删除</button>
      </div>
    `;
    profileListEl.appendChild(li);
  });
  profileListEl.querySelectorAll<HTMLButtonElement>("button[data-profile]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.profile);
      if (!confirm("确认删除该 Profile？")) return;
      try {
        const res = await deleteIOSProfile(id);
        if (!res.ok) throw new Error("delete failed");
        await loadProfiles();
      } catch (err) {
        alert("删除失败：" + describeError(err));
      }
    });
  });
}

async function loadCertificates(): Promise<void> {
  try {
    const { data } = await fetchIOSCertificates();
    certificates = data.certificates ?? [];
    if (!data.encryption_ready) {
      resourceWarningEl.hidden = false;
      resourceWarningEl.textContent =
        "⚠ 服务端未配置 IOSDIST_RESOURCE_KEY 环境变量，证书密码会以明文存储。生产环境请尽快设置 32 字节的 hex/base64 密钥。";
    } else {
      resourceWarningEl.hidden = true;
    }
  } catch {
    certificates = [];
  }
  renderCertList();
}

async function loadProfiles(): Promise<void> {
  try {
    const { data } = await fetchIOSProfiles();
    profiles = data.profiles ?? [];
  } catch {
    profiles = [];
  }
  renderProfileList();
}

// ---- Cert + Profile modals ------------------------------------------------

function openCertModal(): void {
  setModalOpen(certModal, true);
  certFormStatus.textContent = "";
  certForm.reset();
  certNameInput.focus();
}
function closeCertModal(): void {
  setModalOpen(certModal, false);
}
function openProfileModal(): void {
  setModalOpen(profileModal, true);
  profileFormStatus.textContent = "";
  profileForm.reset();
  profileNameInput.focus();
}
function closeProfileModal(): void {
  setModalOpen(profileModal, false);
}

openCertModalBtn.addEventListener("click", openCertModal);
certModalCloseBtn.addEventListener("click", closeCertModal);
certModal.querySelector(".modal-backdrop")?.addEventListener("click", closeCertModal);

certForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const file = certFileInput.files?.[0];
  if (!file) {
    certFormStatus.textContent = "请选择证书文件";
    return;
  }
  const kind = certKindInput.value as IOSCertificate["kind"];
  certFormStatus.textContent = "上传中...";
  try {
    const { response } = await uploadIOSCertificate({
      file,
      name: certNameInput.value.trim(),
      kind,
      password: certPasswordInput.value || undefined,
      team_id: certTeamInput.value.trim() || undefined,
      common_name: certCommonInput.value.trim() || undefined,
      notes: certNotesInput.value.trim() || undefined,
    });
    if (!response.ok) throw new Error("upload failed");
    closeCertModal();
    await loadCertificates();
  } catch (err) {
    certFormStatus.textContent = "上传失败：" + describeError(err);
  }
});

openProfileModalBtn.addEventListener("click", openProfileModal);
profileModalCloseBtn.addEventListener("click", closeProfileModal);
profileModal.querySelector(".modal-backdrop")?.addEventListener("click", closeProfileModal);

profileForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const file = profileFileInput.files?.[0];
  if (!file) {
    profileFormStatus.textContent = "请选择 Profile 文件";
    return;
  }
  profileFormStatus.textContent = "上传中...";
  try {
    const { response } = await uploadIOSProfile({
      file,
      name: profileNameInput.value.trim(),
      kind: profileKindInput.value as IOSDistType,
      app_id: profileAppIDInput.value.trim() || undefined,
      team_id: profileTeamInput.value.trim() || undefined,
      notes: profileNotesInput.value.trim() || undefined,
    });
    if (!response.ok) throw new Error("upload failed");
    closeProfileModal();
    await loadProfiles();
  } catch (err) {
    profileFormStatus.textContent = "上传失败：" + describeError(err);
  }
});

// ---- Public share + test request inbox ---------------------------------

publicToggle.addEventListener("change", async () => {
  if (!activeAppID) return;
  publicStatus.textContent = "保存中...";
  try {
    const { response, data } = await updateIOSAppVisibility(activeAppID, publicToggle.checked);
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "保存失败";
      throw new Error(err);
    }
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    publicStatus.textContent = data.app.is_public ? "已公开" : "已下线";
  } catch (err) {
    publicStatus.textContent = "保存失败：" + describeError(err);
    publicToggle.checked = !publicToggle.checked; // revert
  }
});

publicCopyBtn.addEventListener("click", async () => {
  const url = publicURL.textContent || "";
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    publicStatus.textContent = "已复制到剪贴板";
  } catch {
    publicStatus.textContent = "复制失败，请手动复制";
  }
});

function renderTestRequests(requests: IOSTestRequest[]): void {
  if (requests.length === 0) {
    testRequestList.innerHTML = `<li class="chat-empty">尚无测试申请</li>`;
    return;
  }
  testRequestList.innerHTML = "";
  requests.forEach((r) => {
    const li = document.createElement("li");
    li.style.padding = "10px 0";
    li.style.borderBottom = "1px solid var(--border, rgba(0,0,0,0.06))";
    let badge = `<span class="settings-value-pill">pending</span>`;
    if (r.status === "sent") {
      badge = `<span class="settings-value-pill" style="background:#e6f4ea;color:#0b6b2c;">已发送邀请</span>`;
    } else if (r.status === "failed") {
      badge = `<span class="settings-value-pill" style="background:#fde2e1;color:#a30000;" title="${escapeHTML(r.asc_response)}">失败</span>`;
    }
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
    li.innerHTML = `
      <div style="display:flex; justify-content:space-between; gap:8px;">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600;">${escapeHTML(r.email)} ${badge}</div>
          <div class="settings-info-meta" style="margin-top:4px;">
            ${name ? escapeHTML(name) + " · " : ""}${fmtTime(r.created_at)}${r.source_ip ? " · " + escapeHTML(r.source_ip) : ""}
          </div>
          ${r.asc_response && r.status !== "sent" ? `<div class="drawer-help" style="margin-top:4px;">${escapeHTML(r.asc_response)}</div>` : ""}
        </div>
      </div>
    `;
    testRequestList.appendChild(li);
  });
}

async function loadTestRequests(): Promise<void> {
  if (!activeAppID) {
    testRequestList.innerHTML = "";
    return;
  }
  try {
    const { data } = await fetchIOSAppTestRequests(activeAppID);
    renderTestRequests(data.requests ?? []);
  } catch {
    testRequestList.innerHTML = `<li class="chat-empty">无法加载</li>`;
  }
}

testRequestRefreshBtn.addEventListener("click", () => void loadTestRequests());

// ---- ASC integration ------------------------------------------------------

function populateASCAppSelect(currentID: string): void {
  if (ascAppCache.length === 0) {
    ascAppSelect.innerHTML = `<option value="">（点「刷新 ASC 列表」加载）</option>`;
    return;
  }
  const opts = [`<option value="">（请选择）</option>`];
  ascAppCache.forEach((a) => {
    const sel = a.id === currentID ? " selected" : "";
    opts.push(`<option value="${escapeHTML(a.id)}"${sel}>${escapeHTML(a.name || a.bundle_id)} · ${escapeHTML(a.bundle_id)}</option>`);
  });
  ascAppSelect.innerHTML = opts.join("");
}

function populateASCBetaGroupSelect(currentID: string): void {
  if (ascBetaGroupCache.length === 0) {
    ascBetaGroupSelect.innerHTML = `<option value="">（先选 ASC App 后刷新）</option>`;
    return;
  }
  const opts = [`<option value="">（请选择）</option>`];
  ascBetaGroupCache.forEach((g) => {
    const sel = g.id === currentID ? " selected" : "";
    const tag = g.is_internal ? " · 内部" : (g.public_link_enabled ? " · 公开链接" : "");
    opts.push(`<option value="${escapeHTML(g.id)}"${sel}>${escapeHTML(g.name)}${tag}</option>`);
  });
  ascBetaGroupSelect.innerHTML = opts.join("");
}

async function loadASCConfigStatus(): Promise<void> {
  try {
    const { data } = await fetchIOSASCConfigStatus();
    ascConfigured = !!data.configured;
    if (data.configured && data.config) {
      // Topbar pill is account-level; keep it terse. Show the account
      // holder email when we managed to fetch it, otherwise fall back
      // to a generic "ASC 已配置". Full Issuer/Key go into title attr.
      const lock = data.config.p8_encrypted ? "🔒" : "⚠";
      const emailSuffix = data.config.account_holder_email
        ? ` · ${data.config.account_holder_email}`
        : "";
      ascConfigStatus.textContent = `${lock} ASC 已配置${emailSuffix}`;
      ascConfigStatus.title = `Issuer ${data.config.issuer_id} · Key ${data.config.key_id} · ${data.config.p8_encrypted ? "AES-GCM 加密" : "明文（IOSDIST_RESOURCE_KEY 未设）"}${data.config.account_holder_email ? "\n账号持有者: " + data.config.account_holder_email : ""}\n\nASC API Key 与平台账号绑定，对所有应用通用。`;
      ascDeleteBtn.hidden = false;
      ascConfigBtn.textContent = "重新配置";
    } else {
      ascConfigStatus.textContent = "ASC 未配置";
      ascConfigStatus.title = data.encryption_ready
        ? "ASC API Key 与平台账号绑定，对所有应用通用。点右侧按钮配置。"
        : "ASC API Key 与平台账号绑定，对所有应用通用。\n注意：IOSDIST_RESOURCE_KEY 环境变量未设置 → .p8 会以明文存储。";
      ascDeleteBtn.hidden = true;
      ascConfigBtn.textContent = "ASC API Key";
    }
  } catch {
    ascConfigured = false;
    ascConfigStatus.textContent = "ASC 状态读取失败";
    ascConfigStatus.title = "";
  }
}

async function refreshASCLists(): Promise<void> {
  if (!ascConfigured) return;
  ascBindingStatus.textContent = "拉取中...";
  try {
    // Filter app list by current iosdist app's bundle id when available
    // — there's no harm in fetching all but it's a friendlier default.
    const app = apps.find((a) => a.id === activeAppID);
    const { data: appsData } = await fetchIOSASCApps(app?.bundle_id);
    ascAppCache = appsData.apps ?? [];
    populateASCAppSelect(app?.asc_app_id ?? "");
    // Beta groups depend on the app selection. If we already have one
    // (either from the app row or from the picker), fetch them too.
    const ascAppID = app?.asc_app_id || ascAppSelect.value || (ascAppCache[0]?.id ?? "");
    if (ascAppID) {
      ascAppSelect.value = ascAppID;
      const { data: groupsData } = await fetchIOSASCBetaGroups(ascAppID);
      ascBetaGroupCache = groupsData.beta_groups ?? [];
      populateASCBetaGroupSelect(app?.asc_beta_group_id ?? "");
    } else {
      ascBetaGroupCache = [];
      populateASCBetaGroupSelect("");
    }
    ascBindingStatus.textContent = "已刷新";
  } catch (err) {
    ascBindingStatus.textContent = "刷新失败：" + describeError(err);
  }
}

// When the user picks a different ASC App, fetch matching beta groups.
ascAppSelect.addEventListener("change", async () => {
  const ascAppID = ascAppSelect.value;
  if (!ascAppID) {
    ascBetaGroupCache = [];
    populateASCBetaGroupSelect("");
    return;
  }
  try {
    const { data } = await fetchIOSASCBetaGroups(ascAppID);
    ascBetaGroupCache = data.beta_groups ?? [];
    populateASCBetaGroupSelect("");
  } catch (err) {
    ascBindingStatus.textContent = "拉取 Beta Group 失败：" + describeError(err);
  }
});

ascRefreshBtn.addEventListener("click", () => void refreshASCLists());

// "从 ASC 同步元数据" — pulls name + description + icon from the bound
// ASC App. Disabled when no ASC App is bound yet (the API would 400
// anyway, but we'd rather block in the UI for clarity).
ascSyncMetaBtn.addEventListener("click", async () => {
  if (!activeAppID) return;
  // Backend auto-resolves ASC App via bundle_id when no binding exists,
  // so we don't need a client-side guard. Just hit it.
  ascSyncMetaBtn.disabled = true;
  ascSyncMetaBtn.textContent = "同步中...";
  ascBindingStatus.textContent = "";
  try {
    const { response, data } = await syncIOSAppFromASC(activeAppID);
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "同步失败";
      throw new Error(err);
    }
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    let summary: string;
    if (data.updated_fields && data.updated_fields.length > 0) {
      summary = `✓ 同步成功 · 更新了 ${data.updated_fields.join(" + ")}`;
    } else {
      summary = "✓ 已检查，无变化";
    }
    // After auto-binding the ASC App, the user still has to choose a
    // Beta Group themselves — picking the wrong one risks leaking
    // prerelease builds. Append a hint when that's the next step.
    if (data.app.asc_app_id && !data.app.asc_beta_group_id) {
      summary += " · 请在下方选择「默认 Beta Group」并点「保存绑定」";
    }
    ascBindingStatus.textContent = summary;
    renderAppList();
    renderAppDetail();
  } catch (err) {
    ascBindingStatus.textContent = "同步失败：" + describeError(err);
  } finally {
    ascSyncMetaBtn.disabled = false;
    ascSyncMetaBtn.textContent = "从 ASC 同步元数据";
  }
});

ascBindingSaveBtn.addEventListener("click", async () => {
  if (!activeAppID) return;
  ascBindingStatus.textContent = "保存中...";
  try {
    const { response, data } = await updateIOSAppASCBinding(activeAppID, {
      asc_app_id: ascAppSelect.value,
      asc_beta_group_id: ascBetaGroupSelect.value,
    });
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "保存失败";
      throw new Error(err);
    }
    const idx = apps.findIndex((a) => a.id === data.app.id);
    if (idx >= 0) apps[idx] = data.app;
    renderAppDetail();
    // If a real ASC App is now bound, automatically pull its meta so
    // the user doesn't have to click "从 ASC 同步元数据" as a second
    // step. Failures here are non-fatal — binding was saved either way.
    if (data.app.asc_app_id) {
      ascBindingStatus.textContent = "已保存绑定，正在拉取 ASC 元数据...";
      try {
        const sync = await syncIOSAppFromASC(activeAppID);
        if (sync.response.ok) {
          const j = sync.data;
          const idx2 = apps.findIndex((a) => a.id === j.app.id);
          if (idx2 >= 0) apps[idx2] = j.app;
          ascBindingStatus.textContent = j.updated_fields && j.updated_fields.length > 0
            ? `✓ 已保存绑定，并从 ASC 同步：${j.updated_fields.join(" + ")}`
            : "✓ 已保存绑定，ASC 元数据无变化";
          renderAppList();
          renderAppDetail();
        } else {
          ascBindingStatus.textContent = "已保存绑定，但 ASC 元数据同步失败：" + ((sync.data as unknown as { error?: string })?.error || "未知错误");
        }
      } catch (syncErr) {
        ascBindingStatus.textContent = "已保存绑定，但 ASC 元数据同步失败：" + describeError(syncErr);
      }
    } else {
      ascBindingStatus.textContent = "已保存（未选 ASC App，没有可同步的元数据）";
    }
  } catch (err) {
    ascBindingStatus.textContent = "保存失败：" + describeError(err);
  }
});

inviteSendBtn.addEventListener("click", async () => {
  if (!activeAppID) return;
  const email = inviteEmailInput.value.trim();
  if (!email) {
    inviteStatus.textContent = "请填写邮箱";
    return;
  }
  inviteStatus.textContent = "发送中（Apple 实际派送邮件可能延迟数分钟）...";
  inviteSendBtn.disabled = true;
  try {
    const { response, data } = await inviteIOSAppTester(activeAppID, {
      email,
      first_name: inviteFirstInput.value.trim() || undefined,
      last_name: inviteLastInput.value.trim() || undefined,
    });
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "邀请失败";
      throw new Error(err);
    }
    inviteStatus.textContent = `已邀请 ${email}，Apple 会向其发送 TestFlight 邀请邮件`;
    inviteEmailInput.value = "";
    inviteFirstInput.value = "";
    inviteLastInput.value = "";
  } catch (err) {
    inviteStatus.textContent = "邀请失败：" + describeError(err);
  } finally {
    inviteSendBtn.disabled = false;
  }
});

// Modal: open / close / save.
function openASCModal(): void {
  setModalOpen(ascModal, true);
  ascFormStatus.textContent = "";
  ascForm.reset();
  ascIssuerInput.focus();
}
function closeASCModal(): void {
  setModalOpen(ascModal, false);
}
ascConfigBtn.addEventListener("click", openASCModal);
ascModalCloseBtn.addEventListener("click", closeASCModal);
ascModal.querySelector(".modal-backdrop")?.addEventListener("click", closeASCModal);

ascForm.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const file = ascP8Input.files?.[0];
  if (!file) {
    ascFormStatus.textContent = "请选择 .p8 文件";
    return;
  }
  ascFormStatus.textContent = "保存中...";
  try {
    const { response, data } = await upsertIOSASCConfig({
      issuer_id: ascIssuerInput.value.trim(),
      key_id: ascKeyIDInput.value.trim(),
      p8: file,
    });
    if (!response.ok) {
      const err = (data as unknown as { error?: string })?.error || "保存失败";
      throw new Error(err);
    }
    closeASCModal();
    await loadASCConfigStatus();
    if (ascConfigured) {
      void refreshASCLists();
    }
    renderAppDetail();
  } catch (err) {
    ascFormStatus.textContent = "保存失败：" + describeError(err);
  }
});

ascDeleteBtn.addEventListener("click", async () => {
  if (!confirm("删除 ASC API Key 后，邮件邀请功能会立即失效。确认继续？")) return;
  try {
    const res = await deleteIOSASCConfig();
    if (!res.ok) throw new Error("delete failed");
    ascAppCache = [];
    ascBetaGroupCache = [];
    await loadASCConfigStatus();
    renderAppDetail();
  } catch (err) {
    alert("删除失败：" + describeError(err));
  }
});

// ---- bootstrap ------------------------------------------------------------

async function init(): Promise<void> {
  await hydrateSiteBrand();
  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
  renderSidebarFoot(data);
  await Promise.all([loadApps(), loadCertificates(), loadProfiles(), loadASCConfigStatus()]);
  if (apps.length > 0) {
    // openApp itself triggers refreshASCLists when ASC is configured,
    // so no need to fire it twice here.
    await openApp(apps[0].id);
  }
}

document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try {
    await logout();
  } finally {
    window.location.replace("/login.html");
  }
});

void init();
