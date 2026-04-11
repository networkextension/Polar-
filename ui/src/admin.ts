import { fetchAdminUserLoginHistory, fetchAdminUsers, updateAdminUserPassword } from "./api/admin.js";
import { logout, fetchCurrentUser } from "./api/session.js";
import { fetchSiteSettings } from "./api/dashboard.js";
import { formatDeviceType } from "./lib/client.js";
import { byId } from "./lib/dom.js";
import { makeDefaultAvatar } from "./lib/avatar.js";
import { hydrateSiteBrand, renderSiteBrand } from "./lib/site.js";
import type { AdminUserSummary } from "./types/admin.js";
import type { LoginRecord } from "./types/dashboard.js";

const welcomeText = byId<HTMLElement>("welcomeText");
const footAvatar = byId<HTMLElement>("lpFootAvatar");
const footName = byId<HTMLElement>("lpFootName");
const footRole = byId<HTMLElement>("lpFootRole");
const logoutBtn = byId<HTMLButtonElement>("logoutBtn");
const searchInput = byId<HTMLInputElement>("searchInput");
const searchBtn = byId<HTMLButtonElement>("searchBtn");
const resetBtn = byId<HTMLButtonElement>("resetBtn");
const userList = byId<HTMLUListElement>("userList");
const userCount = byId<HTMLElement>("userCount");
const prevPageBtn = byId<HTMLButtonElement>("prevPageBtn");
const nextPageBtn = byId<HTMLButtonElement>("nextPageBtn");
const pageInfo = byId<HTMLElement>("pageInfo");
const selectedUserTitle = byId<HTMLElement>("selectedUserTitle");
const selectedUserMeta = byId<HTMLElement>("selectedUserMeta");
const loginHistoryList = byId<HTMLUListElement>("loginHistoryList");
const newPasswordInput = byId<HTMLInputElement>("newPassword");
const confirmPasswordInput = byId<HTMLInputElement>("confirmPassword");
const updatePasswordBtn = byId<HTMLButtonElement>("updatePasswordBtn");
const passwordStatus = byId<HTMLElement>("passwordStatus");

const pageSize = 20;
let query = "";
let currentPage = 1;
let totalUsers = 0;
let users: AdminUserSummary[] = [];
let selectedUserID = "";

function setFootUser(username: string, role: string, iconURL?: string): void {
  footName.textContent = username || "管理员";
  footRole.textContent = role === "admin" ? "Administrator" : "Member";
  if (iconURL) {
    footAvatar.style.backgroundImage = `url(${iconURL})`;
    footAvatar.style.backgroundSize = "cover";
    footAvatar.style.backgroundPosition = "center";
    footAvatar.textContent = "";
    return;
  }
  footAvatar.style.backgroundImage = "";
  footAvatar.textContent = (username || "A").slice(0, 1).toUpperCase();
}

function formatLocation(record: LoginRecord): string {
  const parts = [record.city, record.region, record.country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "未知位置";
}

function formatLoginMethod(method?: string): string {
  if (method === "passkey") {
    return "Passkey";
  }
  if (method === "register") {
    return "注册";
  }
  return "密码";
}

function renderUserList(reset = false): void {
  if (reset) {
    userList.innerHTML = "";
  }
  if (!users.length) {
    userList.innerHTML = `<li class="tag-item tag-item-empty">没有匹配用户</li>`;
    return;
  }

  userList.innerHTML = users
    .map((user) => {
      const createdAt = new Date(user.created_at).toLocaleString();
      return `
        <li class="tag-item ${user.id === selectedUserID ? "active" : ""}" data-user-id="${user.id}">
          <div class="tag-item-main">
            <div class="tag-item-header">
              <strong>${user.username}</strong>
              <span class="tag-chip">${user.role}</span>
              ${user.is_online ? `<span class="tag-chip">online</span>` : ""}
            </div>
            <div class="tag-item-meta">${user.email}</div>
            <div class="tag-item-desc">ID: ${user.id}</div>
            <div class="tag-item-meta">创建时间: ${createdAt}</div>
          </div>
        </li>
      `;
    })
    .join("");
}

function renderLoginHistory(records: LoginRecord[]): void {
  if (!records.length) {
    loginHistoryList.innerHTML = "<li>暂无登录记录</li>";
    return;
  }

  loginHistoryList.innerHTML = records
    .map((record) => {
      const time = new Date(record.logged_in_at).toLocaleString();
      return `
        <li>
          <div class="meta-title">${record.ip_address || "未知 IP"} · ${formatLoginMethod(record.login_method)} · ${formatDeviceType(record.device_type, (k) => k)}</div>
          <div class="meta-subtitle">${formatLocation(record)}</div>
          <div class="meta-time">${time}</div>
        </li>
      `;
    })
    .join("");
}

async function loadUsers(reset = false): Promise<void> {
  if (reset) {
    currentPage = 1;
  }
  const offset = (currentPage - 1) * pageSize;
  const { response, data } = await fetchAdminUsers(query, pageSize, offset);
  if (!response.ok) {
    userList.innerHTML = `<li>${data.error || "加载用户失败"}</li>`;
    userCount.textContent = "用户总数: -";
    pageInfo.textContent = "第 - 页";
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
    return;
  }

  users = data.users || [];
  totalUsers = Number(data.total || 0);
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  userCount.textContent = `用户总数: ${totalUsers}`;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  renderUserList(true);

  if (selectedUserID && !users.some((item) => item.id === selectedUserID)) {
    selectedUserID = "";
    selectedUserTitle.textContent = "请选择左侧用户";
    selectedUserMeta.textContent = "-";
    loginHistoryList.innerHTML = "";
  }
}

async function selectUser(userID: string): Promise<void> {
  selectedUserID = userID;
  const user = users.find((item) => item.id === userID);
  if (!user) {
    return;
  }

  renderUserList(true);
  selectedUserTitle.textContent = `${user.username} (${user.role})`;
  selectedUserMeta.textContent = `${user.email} · ${user.id}`;
  passwordStatus.textContent = "";
  newPasswordInput.value = "";
  confirmPasswordInput.value = "";

  const { response, data } = await fetchAdminUserLoginHistory(userID, 30);
  if (!response.ok) {
    loginHistoryList.innerHTML = `<li>${data.error || "加载登录记录失败"}</li>`;
    return;
  }
  renderLoginHistory(data.records || []);
}

async function bootstrap(): Promise<void> {
  await hydrateSiteBrand();

  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.replace("/login.html");
    return;
  }
  if (data.role !== "admin") {
    window.location.replace("/dashboard.html");
    return;
  }

  welcomeText.textContent = `欢迎你，${data.username}`;
  setFootUser(data.username || "Admin", data.role || "admin", data.icon_url);

  // Keep brand rendered even when site-settings API has temporary issue.
  if (!document.querySelector("[data-site-name]")?.textContent?.trim()) {
    try {
      const settings = await fetchSiteSettings();
      if (settings.response.ok) {
        renderSiteBrand(settings.data.site);
      } else {
        renderSiteBrand({ name: "Polar-", icon_url: makeDefaultAvatar("Polar-", 160) });
      }
    } catch {
      renderSiteBrand({ name: "Polar-" });
    }
  }

  await loadUsers(true);
}

searchBtn.addEventListener("click", () => {
  query = searchInput.value.trim();
  void loadUsers(true);
});

searchInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") {
    return;
  }
  query = searchInput.value.trim();
  void loadUsers(true);
});

resetBtn.addEventListener("click", () => {
  searchInput.value = "";
  query = "";
  void loadUsers(true);
});

prevPageBtn.addEventListener("click", () => {
  if (currentPage <= 1) {
    return;
  }
  currentPage -= 1;
  void loadUsers(false);
});

nextPageBtn.addEventListener("click", () => {
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  if (currentPage >= totalPages) {
    return;
  }
  currentPage += 1;
  void loadUsers(false);
});

userList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const item = target.closest<HTMLElement>("[data-user-id]");
  if (!item) {
    return;
  }
  const userID = item.dataset.userId || "";
  if (!userID) {
    return;
  }
  void selectUser(userID);
});

updatePasswordBtn.addEventListener("click", async () => {
  if (!selectedUserID) {
    passwordStatus.textContent = "请先选择用户";
    return;
  }

  const newPassword = newPasswordInput.value.trim();
  const confirm = confirmPasswordInput.value.trim();
  if (newPassword.length < 6) {
    passwordStatus.textContent = "新密码至少 6 位";
    return;
  }
  if (newPassword !== confirm) {
    passwordStatus.textContent = "两次输入密码不一致";
    return;
  }

  updatePasswordBtn.disabled = true;
  passwordStatus.textContent = "正在更新密码...";
  try {
    const { response, data } = await updateAdminUserPassword(selectedUserID, newPassword);
    if (!response.ok) {
      passwordStatus.textContent = data.error || "更新失败";
      return;
    }
    passwordStatus.textContent = data.message || "密码已更新";
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
  } catch {
    passwordStatus.textContent = "网络错误，请重试";
  } finally {
    updatePasswordBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  try {
    const response = await logout();
    if (response.ok) {
      window.location.replace("/login.html");
      return;
    }
    welcomeText.textContent = "退出失败";
  } catch {
    welcomeText.textContent = "网络错误，请重试";
  } finally {
    logoutBtn.disabled = false;
  }
});

void bootstrap();
