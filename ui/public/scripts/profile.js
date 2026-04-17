import { blockUser, unblockUser, upsertRecommendation, updateMyProfile, fetchUserProfile, followUser, unfollowUser, fetchFollowers, fetchFollowing, } from "./api/profile.js";
import { uploadUserIcon } from "./api/dashboard.js";
import { fetchCurrentUser, logout, sendEmailVerification } from "./api/session.js";
import { resolveAvatar } from "./lib/avatar.js";
import { byId } from "./lib/dom.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { t } from "./lib/i18n.js";
const profileWelcome = byId("profileWelcome");
const profileCard = byId("profileCard");
const profileBioPanel = byId("profileBioPanel");
const profileFollowPanel = byId("profileFollowPanel");
const profileRecommendationPanel = byId("profileRecommendationPanel");
let currentUserId = "";
let currentUserEmail = "";
let currentUserEmailVerified = false;
let profileUserId = "";
let followTab = "followers";
let followCurrentProfile = null;
initStoredTheme();
bindThemeSync();
function getUserId() {
    return new URLSearchParams(window.location.search).get("user_id");
}
function formatTime(value) {
    return new Date(value).toLocaleString();
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
async function loadCurrentUser() {
    const { response, data } = await fetchCurrentUser();
    if (!response.ok) {
        window.location.href = "/login.html";
        return;
    }
    currentUserId = data.user_id;
    currentUserEmail = data.email || "";
    currentUserEmailVerified = Boolean(data.email_verified);
    renderSidebarFoot(data);
}
function renderProfileCard(profile) {
    const avatar = resolveAvatar(profile.username, profile.icon_url, 120);
    const emailLine = profile.is_me && profile.email
        ? `<div class="profile-meta-line profile-email-line"><span class="profile-meta-label">${t("profile.email")}</span><a class="profile-email-link" href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a></div>`
        : "";
    const canMessage = !profile.is_me && !profile.i_blocked_user && !profile.blocked_me;
    const blockMessage = profile.i_blocked_user
        ? t("profile.youBlockedUser")
        : profile.blocked_me
            ? t("profile.userBlockedYou")
            : "";
    const messageAction = canMessage
        ? `<a class="btn-inline btn-secondary" href="/chat.html?user_id=${encodeURIComponent(profile.user_id)}&username=${encodeURIComponent(profile.username)}">${t("profile.sendMessage")}</a>`
        : "";
    const canFollow = !profile.is_me && !profile.i_blocked_user && !profile.blocked_me;
    const followAction = canFollow
        ? `<button id="profileFollowBtn" class="btn-inline ${profile.is_following ? "btn-secondary" : "btn-primary"}" type="button">${profile.is_following ? t("profile.unfollowUser") : t("profile.followUser")}</button>`
        : "";
    const blockAction = !profile.is_me
        ? `<button id="profileBlockBtn" class="btn-inline btn-secondary" type="button">${profile.i_blocked_user ? t("profile.unblockUser") : t("profile.blockUser")}</button>`
        : "";
    const followerCount = profile.follower_count ?? 0;
    const followingCount = profile.following_count ?? 0;
    const followSummary = `
    <div class="profile-meta-line profile-follow-summary">
      <span class="profile-follow-count"><strong>${followerCount}</strong> ${t("profile.followersLabel")}</span>
      <span class="profile-follow-count"><strong>${followingCount}</strong> ${t("profile.followingLabel")}</span>
      ${profile.followed_me ? `<span class="tag-chip">${t("profile.followsYou")}</span>` : ""}
    </div>
  `;
    const statusLine = blockMessage
        ? `<div class="status-text">${escapeHtml(blockMessage)}</div>`
        : "";
    profileCard.innerHTML = `
    <div class="profile-hero">
      <img class="profile-hero-avatar" src="${avatar}" alt="${profile.username}" />
      <div class="profile-hero-body">
        <div class="badge">${profile.is_me ? t("profile.myProfile") : t("profile.userProfile")}</div>
        <h2>${profile.username}</h2>
        ${emailLine}
        <div class="profile-meta-line">${t("profile.userId", { id: profile.user_id })}</div>
        <div class="profile-meta-line">${t("profile.joinedAt", { time: formatTime(profile.created_at) })}</div>
        ${followSummary}
        <div class="task-form-actions">${messageAction}${followAction}${blockAction}</div>
        ${statusLine}
      </div>
    </div>
  `;
    if (profile.is_me) {
        return;
    }
    const followBtn = document.getElementById("profileFollowBtn");
    followBtn?.addEventListener("click", async () => {
        followBtn.disabled = true;
        const result = profile.is_following
            ? await unfollowUser(profile.user_id)
            : await followUser(profile.user_id);
        if (!result.response.ok || !result.data.profile) {
            profileWelcome.textContent = result.data.error || t("profile.followActionFailed");
            followBtn.disabled = false;
            return;
        }
        profileWelcome.textContent = result.data.message || "";
        const updated = result.data.profile;
        renderProfileCard(updated);
        renderBioPanel(updated);
        renderFollowPanel(updated);
        renderRecommendationPanel(updated);
    });
    const blockBtn = byId("profileBlockBtn");
    blockBtn.addEventListener("click", async () => {
        blockBtn.disabled = true;
        const result = profile.i_blocked_user ? await unblockUser(profile.user_id) : await blockUser(profile.user_id);
        if (!result.response.ok || !result.data.profile) {
            profileWelcome.textContent = result.data.error || t("profile.blockActionFailed");
            blockBtn.disabled = false;
            return;
        }
        profileWelcome.textContent = result.data.message || "";
        const updated = result.data.profile;
        renderProfileCard(updated);
        renderBioPanel(updated);
        renderFollowPanel(updated);
        renderRecommendationPanel(updated);
    });
}
function renderFollowUserList(users) {
    if (!users.length) {
        const emptyKey = followTab === "followers" ? "profile.noFollowers" : "profile.noFollowing";
        return `<div class='reply-empty'>${t(emptyKey)}</div>`;
    }
    return users
        .map((user) => {
        const avatar = resolveAvatar(user.username, user.user_icon, 40);
        const bio = user.bio ? `<div class="reply-meta">${escapeHtml(user.bio)}</div>` : "";
        const followBadge = user.is_following ? `<span class="tag-chip">${t("profile.followingLabel")}</span>` : "";
        return `
        <div class="profile-recommendation-item">
          <div class="task-applicant-head">
            <a href="/profile.html?user_id=${encodeURIComponent(user.id)}">
              <img class="avatar-xs" src="${avatar}" alt="${escapeHtml(user.username)}" />
            </a>
            <div>
              <a class="post-author-name" href="/profile.html?user_id=${encodeURIComponent(user.id)}">${escapeHtml(user.username)}</a>
              ${bio}
            </div>
            ${followBadge}
          </div>
        </div>
      `;
    })
        .join("");
}
async function loadFollowList() {
    if (!followCurrentProfile) {
        return;
    }
    const container = document.getElementById("profileFollowList");
    if (!container) {
        return;
    }
    container.innerHTML = `<div class='reply-empty'>${t("profile.loadingFollowList")}</div>`;
    const targetUserId = followCurrentProfile.user_id;
    const fetcher = followTab === "followers" ? fetchFollowers : fetchFollowing;
    const { response, data } = await fetcher(targetUserId, 30, 0);
    if (!response.ok) {
        container.innerHTML = `<div class='reply-empty'>${t("profile.followListLoadFailed")}</div>`;
        return;
    }
    container.innerHTML = renderFollowUserList(data.users || []);
}
function renderFollowPanel(profile) {
    followCurrentProfile = profile;
    const followerCount = profile.follower_count ?? 0;
    const followingCount = profile.following_count ?? 0;
    profileFollowPanel.innerHTML = `
    <div class="badge">${t("profile.followSection")}</div>
    <div class="lp-filter-bar" style="margin-top:8px;">
      <button class="btn-inline btn-secondary profile-follow-tab ${followTab === "followers" ? "active" : ""}" data-follow-tab="followers" type="button">${t("profile.tabFollowers", { count: String(followerCount) })}</button>
      <button class="btn-inline btn-secondary profile-follow-tab ${followTab === "following" ? "active" : ""}" data-follow-tab="following" type="button">${t("profile.tabFollowing", { count: String(followingCount) })}</button>
    </div>
    <div id="profileFollowList" class="task-result-list" style="margin-top:8px;"></div>
  `;
    profileFollowPanel.querySelectorAll(".profile-follow-tab").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const next = btn.dataset.followTab || "followers";
            if (next === followTab) {
                return;
            }
            followTab = next;
            renderFollowPanel(profile);
            await loadFollowList();
        });
    });
    void loadFollowList();
}
function renderBioPanel(profile) {
    if (profile.is_me) {
        const verificationState = currentUserEmailVerified ? t("profile.emailVerified") : t("profile.emailUnverified");
        const verificationAction = currentUserEmailVerified
            ? ""
            : `<button id="profileSendVerificationBtn" class="btn-inline btn-secondary" type="button">${t("profile.sendVerificationEmail")}</button>`;
        profileBioPanel.innerHTML = `
      <div class="badge">${t("profile.bio")}</div>
      <div class="profile-verification-card">
        <div class="profile-meta-line"><span class="profile-meta-label">${t("profile.email")}</span><span>${escapeHtml(currentUserEmail || t("profile.emailUnavailable"))}</span></div>
        <div class="profile-meta-line"><span class="profile-meta-label">${t("profile.emailVerificationStatus")}</span><span>${verificationState}</span></div>
        <div id="profileEmailVerificationStatus" class="status-text"></div>
        <div class="task-form-actions">
          ${verificationAction}
        </div>
      </div>
      <form id="profileBioForm" class="task-result-form">
        <label class="form-label" for="profileBioInput">${t("profile.personalBio")}</label>
        <textarea id="profileBioInput" class="input textarea" rows="5" maxlength="500" placeholder="${t("profile.bioPlaceholder")}">${escapeHtml(profile.bio || "")}</textarea>
        <label class="form-label" for="profileIconInput">${t("profile.avatar")}</label>
        <input id="profileIconInput" class="input" type="file" accept="image/*" />
        <div id="profileBioStatus" class="status-text"></div>
        <div class="task-form-actions">
          <button class="btn-inline btn-secondary" type="submit">${t("profile.saveProfile")}</button>
        </div>
      </form>
    `;
        const form = byId("profileBioForm");
        const bioInput = byId("profileBioInput");
        const iconInput = byId("profileIconInput");
        const status = byId("profileBioStatus");
        const verificationStatus = byId("profileEmailVerificationStatus");
        const verificationBtn = document.getElementById("profileSendVerificationBtn");
        verificationBtn?.addEventListener("click", async () => {
            verificationBtn.disabled = true;
            verificationStatus.textContent = t("profile.sendingVerificationEmail");
            const { response, data } = await sendEmailVerification();
            if (!response.ok) {
                verificationStatus.textContent = data.error || t("profile.emailVerificationSendFailed");
                verificationStatus.classList.remove("status-success");
                verificationStatus.classList.add("status-error");
                verificationBtn.disabled = false;
                return;
            }
            const me = await fetchCurrentUser();
            if (me.response.ok) {
                currentUserEmail = me.data.email || currentUserEmail;
                currentUserEmailVerified = Boolean(me.data.email_verified);
            }
            verificationStatus.textContent = data.message || t("profile.verificationEmailSent");
            verificationStatus.classList.remove("status-error");
            verificationStatus.classList.add("status-success");
            await loadProfile();
        });
        form.addEventListener("submit", async (event) => {
            event.preventDefault();
            status.textContent = t("profile.saving");
            const { response, data } = await updateMyProfile(bioInput.value.trim());
            if (!response.ok) {
                status.textContent = data.error || t("profile.saveFailed");
                return;
            }
            const iconFile = iconInput.files?.[0];
            if (iconFile) {
                const formData = new FormData();
                formData.append("icon", iconFile);
                const { response: iconResponse, data: iconData } = await uploadUserIcon(formData);
                if (!iconResponse.ok) {
                    status.textContent = iconData.error || t("profile.avatarUploadFailed");
                    return;
                }
            }
            status.textContent = t("profile.profileUpdated");
            await loadProfile();
        });
        return;
    }
    profileBioPanel.innerHTML = `
    <div class="badge">${t("profile.bio")}</div>
    <div class="profile-bio-copy">${profile.bio ? escapeHtml(profile.bio) : t("profile.noBio")}</div>
  `;
}
function renderRecommendationPanel(profile) {
    const recommendations = profile.recommendations || [];
    const formHtml = profile.can_recommend
        && !profile.i_blocked_user
        && !profile.blocked_me
        ? `
      <form id="recommendationForm" class="task-result-form">
        <label class="form-label" for="recommendationInput">${t("profile.writeRecommendation")}</label>
        <textarea id="recommendationInput" class="input textarea" rows="4" maxlength="1000" placeholder="${t("profile.recommendationPlaceholder")}"></textarea>
        <div id="recommendationStatus" class="status-text"></div>
        <div class="task-form-actions">
          <button class="btn-inline btn-secondary" type="submit">${t("profile.submitRecommendation")}</button>
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
        : `<div class='reply-empty'>${t("profile.noRecommendations")}</div>`;
    profileRecommendationPanel.innerHTML = `
    <div class="badge">${t("profile.recommendation")}</div>
    ${profile.i_blocked_user || profile.blocked_me ? `<div class="status-text">${profile.i_blocked_user ? t("profile.recommendationBlockedByYou") : t("profile.recommendationBlockedByOther")}</div>` : ""}
    ${formHtml}
    <div class="task-result-list">${listHtml}</div>
  `;
    if (!profile.can_recommend || profile.i_blocked_user || profile.blocked_me) {
        return;
    }
    const form = byId("recommendationForm");
    const input = byId("recommendationInput");
    const status = byId("recommendationStatus");
    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const content = input.value.trim();
        if (!content) {
            status.textContent = t("profile.recommendationRequired");
            return;
        }
        status.textContent = t("profile.submitting");
        const { response, data } = await upsertRecommendation(profile.user_id, content);
        if (!response.ok) {
            status.textContent = data.error || t("profile.submitFailed");
            return;
        }
        status.textContent = t("profile.recommendationSaved");
        input.value = "";
        await loadProfile();
    });
}
async function loadProfile() {
    const userId = getUserId() || currentUserId;
    profileUserId = userId;
    const { response, data } = await fetchUserProfile(userId);
    if (!response.ok || !data.profile) {
        profileWelcome.textContent = data.error || t("profile.loadFailed");
        return;
    }
    const profile = data.profile;
    profileWelcome.textContent = profile.is_me
        ? t("profile.completeProfile")
        : t("profile.viewingProfile", { username: profile.username });
    renderProfileCard(profile);
    renderBioPanel(profile);
    renderFollowPanel(profile);
    renderRecommendationPanel(profile);
}
async function init() {
    await hydrateSiteBrand();
    await loadCurrentUser();
    await loadProfile();
}
void init();
// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    try {
        await logout();
    }
    finally {
        window.location.replace("/login.html");
    }
});
