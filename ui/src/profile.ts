import { upsertRecommendation, updateMyProfile, fetchUserProfile, type UserProfileDetail } from "./api/profile.js";
import { uploadUserIcon } from "./api/dashboard.js";
import { fetchCurrentUser } from "./api/session.js";
import { resolveAvatar } from "./lib/avatar.js";
import { byId } from "./lib/dom.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";

const profileWelcome = byId<HTMLElement>("profileWelcome");
const profileCard = byId<HTMLElement>("profileCard");
const profileBioPanel = byId<HTMLElement>("profileBioPanel");
const profileRecommendationPanel = byId<HTMLElement>("profileRecommendationPanel");

let currentUserId = "";
let profileUserId = "";

initStoredTheme();
bindThemeSync();

function getUserId(): string | null {
  return new URLSearchParams(window.location.search).get("user_id");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadCurrentUser(): Promise<void> {
  const { response, data } = await fetchCurrentUser();
  if (!response.ok) {
    window.location.href = "/login.html";
    return;
  }
  currentUserId = data.user_id;
}

function renderProfileCard(profile: UserProfileDetail): void {
  const avatar = resolveAvatar(profile.username, profile.icon_url, 120);
  profileCard.innerHTML = `
    <div class="profile-hero">
      <img class="profile-hero-avatar" src="${avatar}" alt="${profile.username}" />
      <div class="profile-hero-body">
        <div class="badge">${profile.is_me ? "我的资料" : "用户资料"}</div>
        <h2>${profile.username}</h2>
        <div class="profile-meta-line">用户 ID：${profile.user_id}</div>
        <div class="profile-meta-line">加入时间：${formatTime(profile.created_at)}</div>
      </div>
    </div>
  `;
}

function renderBioPanel(profile: UserProfileDetail): void {
  if (profile.is_me) {
    profileBioPanel.innerHTML = `
      <div class="badge">自我介绍</div>
      <form id="profileBioForm" class="task-result-form">
        <label class="form-label" for="profileBioInput">个人介绍</label>
        <textarea id="profileBioInput" class="input textarea" rows="5" maxlength="500" placeholder="介绍一下自己擅长什么、做过哪些任务、可服务的时间段...">${escapeHtml(profile.bio || "")}</textarea>
        <label class="form-label" for="profileIconInput">头像</label>
        <input id="profileIconInput" class="input" type="file" accept="image/*" />
        <div id="profileBioStatus" class="status-text"></div>
        <div class="task-form-actions">
          <button class="btn-inline btn-secondary" type="submit">保存资料</button>
        </div>
      </form>
    `;

    const form = byId<HTMLFormElement>("profileBioForm");
    const bioInput = byId<HTMLTextAreaElement>("profileBioInput");
    const iconInput = byId<HTMLInputElement>("profileIconInput");
    const status = byId<HTMLElement>("profileBioStatus");

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      status.textContent = "正在保存...";
      const { response, data } = await updateMyProfile(bioInput.value.trim());
      if (!response.ok) {
        status.textContent = data.error || "保存失败";
        return;
      }

      const iconFile = iconInput.files?.[0];
      if (iconFile) {
        const formData = new FormData();
        formData.append("icon", iconFile);
        const { response: iconResponse, data: iconData } = await uploadUserIcon(formData);
        if (!iconResponse.ok) {
          status.textContent = iconData.error || "头像上传失败";
          return;
        }
      }
      status.textContent = "资料已更新";
      await loadProfile();
    });
    return;
  }

  profileBioPanel.innerHTML = `
    <div class="badge">自我介绍</div>
    <div class="profile-bio-copy">${profile.bio ? escapeHtml(profile.bio) : "这个用户暂时还没有填写自我介绍。"}</div>
  `;
}

function renderRecommendationPanel(profile: UserProfileDetail): void {
  const recommendations = profile.recommendations || [];
  const formHtml = profile.can_recommend
    ? `
      <form id="recommendationForm" class="task-result-form">
        <label class="form-label" for="recommendationInput">写 Recommendation</label>
        <textarea id="recommendationInput" class="input textarea" rows="4" maxlength="1000" placeholder="写下你和 TA 合作过的感受、可靠性、执行力等..."></textarea>
        <div id="recommendationStatus" class="status-text"></div>
        <div class="task-form-actions">
          <button class="btn-inline btn-secondary" type="submit">提交 Recommendation</button>
        </div>
      </form>
    `
    : "";

  const listHtml = recommendations.length
    ? recommendations
        .map((item) => {
          const avatar = resolveAvatar(item.author_username, item.author_user_icon, 40);
          return `
            <div class="profile-recommendation-item">
              <div class="task-applicant-head">
                <a href="/profile.html?user_id=${encodeURIComponent(item.author_user_id)}">
                  <img class="avatar-xs" src="${avatar}" alt="${item.author_username}" />
                </a>
                <div>
                  <a class="post-author-name" href="/profile.html?user_id=${encodeURIComponent(item.author_user_id)}">${item.author_username}</a>
                  <div class="reply-meta">${formatTime(item.updated_at)}</div>
                </div>
              </div>
              <div class="profile-bio-copy">${escapeHtml(item.content)}</div>
            </div>
          `;
        })
        .join("")
    : "<div class='reply-empty'>还没有 Recommendation</div>";

  profileRecommendationPanel.innerHTML = `
    <div class="badge">Recommendation</div>
    ${formHtml}
    <div class="task-result-list">${listHtml}</div>
  `;

  if (!profile.can_recommend) {
    return;
  }

  const form = byId<HTMLFormElement>("recommendationForm");
  const input = byId<HTMLTextAreaElement>("recommendationInput");
  const status = byId<HTMLElement>("recommendationStatus");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = input.value.trim();
    if (!content) {
      status.textContent = "请输入 Recommendation 内容";
      return;
    }
    status.textContent = "正在提交...";
    const { response, data } = await upsertRecommendation(profile.user_id, content);
    if (!response.ok) {
      status.textContent = data.error || "提交失败";
      return;
    }
    status.textContent = "Recommendation 已保存";
    input.value = "";
    await loadProfile();
  });
}

async function loadProfile(): Promise<void> {
  const userId = getUserId() || currentUserId;
  profileUserId = userId;
  const { response, data } = await fetchUserProfile(userId);
  if (!response.ok || !data.profile) {
    profileWelcome.textContent = data.error || "无法加载用户资料";
    return;
  }

  const profile = data.profile;
  profileWelcome.textContent = profile.is_me
    ? "完善你的头像和自我介绍，让任务发布者更容易选择你。"
    : `查看 ${profile.username} 的资料与 Recommendation。`;
  renderProfileCard(profile);
  renderBioPanel(profile);
  renderRecommendationPanel(profile);
}

async function init(): Promise<void> {
  await hydrateSiteBrand();
  await loadCurrentUser();
  await loadProfile();
}

void init();
