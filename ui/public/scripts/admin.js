import { fetchAdminUserLoginHistory, fetchAdminUsers, updateAdminUserPassword } from "./api/admin.js";
import { logout, fetchCurrentUser } from "./api/session.js";
import { formatDeviceType } from "./lib/client.js";
import { byId } from "./lib/dom.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { t } from "./lib/i18n.js";
const welcomeText = byId("welcomeText");
const logoutBtn = byId("logoutBtn");
const searchInput = byId("searchInput");
const searchBtn = byId("searchBtn");
const resetBtn = byId("resetBtn");
const userList = byId("userList");
const userCount = byId("userCount");
const prevPageBtn = byId("prevPageBtn");
const nextPageBtn = byId("nextPageBtn");
const pageInfo = byId("pageInfo");
const selectedUserTitle = byId("selectedUserTitle");
const selectedUserMeta = byId("selectedUserMeta");
const loginHistoryList = byId("loginHistoryList");
const newPasswordInput = byId("newPassword");
const confirmPasswordInput = byId("confirmPassword");
const updatePasswordBtn = byId("updatePasswordBtn");
const passwordStatus = byId("passwordStatus");
const pageSize = 20;
let query = "";
let currentPage = 1;
let totalUsers = 0;
let users = [];
let selectedUserID = "";
function formatLocation(record) {
    const parts = [record.city, record.region, record.country].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : t("admin.unknownLocation");
}
function formatLoginMethod(method) {
    if (method === "passkey")
        return t("admin.loginMethodPasskey");
    if (method === "register")
        return t("admin.loginMethodRegister");
    return t("admin.loginMethodPassword");
}
function renderUserList(reset = false) {
    if (reset) {
        userList.innerHTML = "";
    }
    if (!users.length) {
        userList.innerHTML = `<li class="tag-item tag-item-empty">${t("admin.noMatchingUsers")}</li>`;
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
              ${user.is_online ? `<span class="tag-chip">${t("admin.online")}</span>` : ""}
            </div>
            <div class="tag-item-meta">${user.email}</div>
            <div class="tag-item-desc">ID: ${user.id}</div>
            <div class="tag-item-meta">${t("admin.createdAt", { time: createdAt })}</div>
          </div>
        </li>
      `;
    })
        .join("");
}
function renderLoginHistory(records) {
    if (!records.length) {
        loginHistoryList.innerHTML = `<li>${t("admin.noLoginHistory")}</li>`;
        return;
    }
    loginHistoryList.innerHTML = records
        .map((record) => {
        const time = new Date(record.logged_in_at).toLocaleString();
        return `
        <li>
          <div class="meta-title">${record.ip_address || t("admin.unknownIp")} · ${formatLoginMethod(record.login_method)} · ${formatDeviceType(record.device_type, (k) => k)}</div>
          <div class="meta-subtitle">${formatLocation(record)}</div>
          <div class="meta-time">${time}</div>
        </li>
      `;
    })
        .join("");
}
async function loadUsers(reset = false) {
    if (reset) {
        currentPage = 1;
    }
    const offset = (currentPage - 1) * pageSize;
    const { response, data } = await fetchAdminUsers(query, pageSize, offset);
    if (!response.ok) {
        userList.innerHTML = `<li>${data.error || t("admin.loadUsersFailed")}</li>`;
        userCount.textContent = t("admin.userCountDash");
        pageInfo.textContent = t("admin.pageInfoDash");
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
    userCount.textContent = t("admin.userCount", { count: String(totalUsers) });
    pageInfo.textContent = t("admin.pageInfo", { current: String(currentPage), total: String(totalPages) });
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    renderUserList(true);
    if (selectedUserID && !users.some((item) => item.id === selectedUserID)) {
        selectedUserID = "";
        selectedUserTitle.textContent = t("admin.selectUser");
        selectedUserMeta.textContent = "-";
        loginHistoryList.innerHTML = "";
    }
}
async function selectUser(userID) {
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
        loginHistoryList.innerHTML = `<li>${data.error || t("admin.loadHistoryFailed")}</li>`;
        return;
    }
    renderLoginHistory(data.records || []);
}
async function bootstrap() {
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
    welcomeText.textContent = t("admin.welcome", { username: data.username || "" });
    renderSidebarFoot(data);
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
    const target = event.target;
    const item = target.closest("[data-user-id]");
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
        passwordStatus.textContent = t("admin.selectUserFirst");
        return;
    }
    const newPassword = newPasswordInput.value.trim();
    const confirm = confirmPasswordInput.value.trim();
    if (newPassword.length < 6) {
        passwordStatus.textContent = t("admin.passwordTooShort");
        return;
    }
    if (newPassword !== confirm) {
        passwordStatus.textContent = t("admin.passwordMismatch");
        return;
    }
    updatePasswordBtn.disabled = true;
    passwordStatus.textContent = t("admin.updatingPassword");
    try {
        const { response, data } = await updateAdminUserPassword(selectedUserID, newPassword);
        if (!response.ok) {
            passwordStatus.textContent = data.error || t("admin.updateFailed");
            return;
        }
        passwordStatus.textContent = data.message || t("admin.passwordUpdated");
        newPasswordInput.value = "";
        confirmPasswordInput.value = "";
    }
    catch {
        passwordStatus.textContent = t("admin.networkError");
    }
    finally {
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
        welcomeText.textContent = t("admin.logoutFailed");
    }
    catch {
        welcomeText.textContent = t("admin.networkError");
    }
    finally {
        logoutBtn.disabled = false;
    }
});
void bootstrap();
