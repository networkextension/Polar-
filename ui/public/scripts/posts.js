import { buildAssetUrl, resolveAvatar } from "./lib/avatar.js";
import { byId, query } from "./lib/dom.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { fetchTags } from "./api/dashboard.js";
import { t } from "./lib/i18n.js";
import { logout } from "./api/session.js";
const API_BASE = "";
const postWelcome = byId("postWelcome");
const postList = byId("postList");
const postLoadMoreBtn = byId("postLoadMoreBtn");
const postTypeFilters = byId("postTypeFilters");
const tagFilters = byId("tagFilters");
const postListBadge = byId("postListBadge");
let nextOffset = 0;
let hasMore = true;
let currentUserId = "";
let currentUserRole = "user";
let videoModal = null;
let videoModalPlayer = null;
let imageModal = null;
let imageModalViewer = null;
let imageModalCounter = null;
let imageModalPrevBtn = null;
let imageModalNextBtn = null;
let currentImageGallery = [];
let currentImageIndex = 0;
let currentPostTypeFilter = "all";
let currentTagFilter = null;
let currentTags = [];
initStoredTheme();
bindThemeSync();
function formatTime(value) {
    return new Date(value).toLocaleString();
}
function profileUrl(userId) {
    return `/profile.html?user_id=${encodeURIComponent(userId)}`;
}
function getTagName(tagId) {
    if (!tagId) {
        return "";
    }
    return currentTags.find((item) => item.id === tagId)?.name || "";
}
function updateListBadge() {
    if (currentTagFilter) {
        postListBadge.textContent = getTagName(currentTagFilter) || t("posts.sectionPosts");
        return;
    }
    postListBadge.textContent =
        currentPostTypeFilter === "task" ? t("posts.gigTasks") : currentPostTypeFilter === "standard" ? t("posts.regularPosts") : t("posts.latestPosts");
}
function renderTypeFilters() {
    const items = [
        { label: t("posts.filterLatest"), value: "all" },
        { label: t("posts.filterRegular"), value: "standard" },
        { label: t("posts.filterGigs"), value: "task" },
    ];
    postTypeFilters.innerHTML = items
        .map((item) => `<button class="btn-inline btn-secondary post-filter-btn ${currentPostTypeFilter === item.value && !currentTagFilter ? "active" : ""}" data-post-type="${item.value}" type="button">${item.label}</button>`)
        .join("");
    postTypeFilters.querySelectorAll(".post-filter-btn").forEach((button) => {
        button.addEventListener("click", async () => {
            currentPostTypeFilter = button.dataset.postType || "all";
            currentTagFilter = null;
            renderTypeFilters();
            renderTagFilters();
            updateListBadge();
            await loadPosts(true);
        });
    });
}
function renderTagFilters() {
    tagFilters.innerHTML = currentTags
        .map((tag) => `<button class="tag-chip post-tag-filter ${currentTagFilter === tag.id ? "active" : ""}" data-tag-id="${tag.id}" type="button">${tag.name}</button>`)
        .join("");
    tagFilters.querySelectorAll(".post-tag-filter").forEach((button) => {
        button.addEventListener("click", async () => {
            currentTagFilter = Number(button.dataset.tagId);
            currentPostTypeFilter = "all";
            renderTypeFilters();
            renderTagFilters();
            updateListBadge();
            await loadPosts(true);
        });
    });
}
async function loadTags() {
    renderTypeFilters();
    updateListBadge();
    const { response, data } = await fetchTags();
    if (!response.ok) {
        return;
    }
    currentTags = data.tags || [];
    renderTypeFilters();
    renderTagFilters();
    updateListBadge();
}
function ensureImageModal() {
    if (imageModal) {
        return;
    }
    const modal = document.createElement("div");
    modal.className = "image-modal";
    modal.innerHTML = `
    <div class="image-modal-backdrop"></div>
    <div class="image-modal-content">
      <div class="image-modal-toolbar">
        <div class="image-modal-counter">1 / 1</div>
        <button class="image-modal-close btn-inline btn-secondary" type="button">${t("common.close")}</button>
      </div>
      <div class="image-modal-stage">
        <button class="image-modal-nav image-modal-prev btn-inline btn-secondary" type="button" aria-label="${t("post.prevImage")}">${t("post.prevImage")}</button>
        <img class="image-modal-viewer" alt="post image preview" />
        <button class="image-modal-nav image-modal-next btn-inline btn-secondary" type="button" aria-label="${t("post.nextImage")}">${t("post.nextImage")}</button>
      </div>
    </div>
  `;
    document.body.appendChild(modal);
    imageModal = modal;
    imageModalViewer = query(modal, ".image-modal-viewer");
    imageModalCounter = query(modal, ".image-modal-counter");
    imageModalPrevBtn = query(modal, ".image-modal-prev");
    imageModalNextBtn = query(modal, ".image-modal-next");
    const close = () => {
        if (!imageModal || !imageModalViewer) {
            return;
        }
        imageModal.classList.remove("open");
        imageModalViewer.removeAttribute("src");
        currentImageGallery = [];
        currentImageIndex = 0;
    };
    query(modal, ".image-modal-backdrop").addEventListener("click", close);
    query(modal, ".image-modal-close").addEventListener("click", close);
    imageModalPrevBtn.addEventListener("click", () => stepImageModal(-1));
    imageModalNextBtn.addEventListener("click", () => stepImageModal(1));
    document.addEventListener("keydown", (event) => {
        if (!imageModal?.classList.contains("open")) {
            return;
        }
        if (event.key === "Escape") {
            close();
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            stepImageModal(-1);
            return;
        }
        if (event.key === "ArrowRight") {
            event.preventDefault();
            stepImageModal(1);
        }
    });
}
function renderImageModal() {
    if (!imageModal || !imageModalViewer || !imageModalCounter || !imageModalPrevBtn || !imageModalNextBtn) {
        return;
    }
    if (!currentImageGallery.length) {
        imageModal.classList.remove("open");
        return;
    }
    currentImageIndex = (currentImageIndex + currentImageGallery.length) % currentImageGallery.length;
    imageModalViewer.src = currentImageGallery[currentImageIndex];
    imageModalCounter.textContent = `${currentImageIndex + 1} / ${currentImageGallery.length}`;
    const multiple = currentImageGallery.length > 1;
    imageModalPrevBtn.disabled = !multiple;
    imageModalNextBtn.disabled = !multiple;
}
function openImageModal(images, index) {
    if (!images.length) {
        return;
    }
    ensureImageModal();
    if (!imageModal) {
        return;
    }
    currentImageGallery = images;
    currentImageIndex = index;
    renderImageModal();
    imageModal.classList.add("open");
}
function stepImageModal(step) {
    if (!currentImageGallery.length) {
        return;
    }
    currentImageIndex += step;
    renderImageModal();
}
function enhancePostImages(container) {
    container.querySelectorAll(".post-images img").forEach((imageEl) => {
        imageEl.addEventListener("click", (event) => {
            event.stopPropagation();
            const siblings = Array.from(imageEl.closest(".post-images").querySelectorAll("img"));
            const gallery = siblings.map((el) => el.dataset.original || el.src);
            const index = siblings.indexOf(imageEl);
            openImageModal(gallery, index);
        });
    });
}
function ensureVideoModal() {
    if (videoModal) {
        return;
    }
    const modal = document.createElement("div");
    modal.className = "video-modal";
    modal.innerHTML = `
    <div class="video-modal-backdrop"></div>
    <div class="video-modal-content panel">
      <button class="video-modal-close btn-inline btn-secondary" type="button">${t("common.close")}</button>
      <video class="video-modal-player" controls autoplay preload="metadata"></video>
    </div>
  `;
    document.body.appendChild(modal);
    videoModal = modal;
    videoModalPlayer = query(modal, ".video-modal-player");
    const close = () => {
        if (!videoModal) {
            return;
        }
        videoModal.classList.remove("open");
        if (videoModalPlayer) {
            videoModalPlayer.pause();
            videoModalPlayer.removeAttribute("src");
            videoModalPlayer.load();
        }
    };
    query(modal, ".video-modal-backdrop").addEventListener("click", close);
    query(modal, ".video-modal-close").addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            close();
        }
    });
}
function openVideoModal(url) {
    if (!url) {
        return;
    }
    ensureVideoModal();
    if (!videoModal || !videoModalPlayer) {
        return;
    }
    videoModalPlayer.src = url;
    videoModal.classList.add("open");
    void videoModalPlayer.play().catch(() => { });
}
function normalizeVideoItems(post) {
    if (Array.isArray(post.video_items) && post.video_items.length > 0) {
        return post.video_items
            .filter((item) => item && item.url)
            .map((item) => ({
            url: buildAssetUrl(item.url),
            posterUrl: item.poster_url ? buildAssetUrl(item.poster_url) : "",
        }));
    }
    return (post.videos || []).map((url) => ({
        url: buildAssetUrl(url),
        posterUrl: "",
    }));
}
function normalizePostImages(post, variant) {
    if (Array.isArray(post.image_items) && post.image_items.length > 0) {
        return post.image_items
            .filter((item) => item && (item.original_url || item.medium_url || item.small_url))
            .map((item) => {
            if (variant === "small") {
                return buildAssetUrl(item.small_url || item.medium_url || item.original_url);
            }
            if (variant === "medium") {
                return buildAssetUrl(item.medium_url || item.original_url || item.small_url);
            }
            return buildAssetUrl(item.original_url || item.medium_url || item.small_url);
        });
    }
    return (post.images || []).map((url) => buildAssetUrl(url));
}
function enhancePostVideos(container) {
    container.querySelectorAll(".post-videos video").forEach((videoEl) => {
        videoEl.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const source = videoEl.querySelector("source");
            const src = videoEl.currentSrc || source?.src || "";
            videoEl.pause();
            openVideoModal(src);
        });
    });
}
async function loadProfile() {
    const res = await fetch(`${API_BASE}/api/me`, { credentials: "include" });
    if (!res.ok) {
        window.location.href = "/login.html";
        return;
    }
    const data = await res.json();
    currentUserId = data.user_id;
    currentUserRole = data.role || "user";
    postWelcome.textContent = t("posts.welcome", { username: data.username });
    renderSidebarFoot(data);
}
function createPostCard(post) {
    const card = document.createElement("div");
    card.className = "post-card panel";
    const smallImages = normalizePostImages(post, "small");
    const origImages = normalizePostImages(post, "original");
    const images = smallImages
        .map((url, i) => `<img src="${url}" data-original="${origImages[i] ?? url}" alt="post image" loading="lazy" />`)
        .join("");
    const videos = normalizeVideoItems(post)
        .map((item) => `
        <video controls preload="metadata" ${item.posterUrl ? `poster="${item.posterUrl}"` : ""}>
          <source src="${item.url}" />
          ${t("posts.videoNotSupported")}
        </video>
      `)
        .join("");
    const videoSection = videos ? `<div class="post-videos">${videos}</div>` : "";
    const isSelf = currentUserId && post.user_id === currentUserId;
    const canDelete = currentUserRole === "admin" || isSelf;
    const authorLabel = `<a class="post-author-name" href="${profileUrl(post.user_id)}">${post.username}</a>`;
    const avatar = resolveAvatar(post.username, post.user_icon, 64);
    const taskSummary = post.post_type === "task" && post.task
        ? `
        <div class="task-summary-strip">
          <span class="badge">${t("posts.gigTaskBadge")}</span>
          <span>${t("posts.taskTime", { start: formatTime(post.task.start_at), end: formatTime(post.task.end_at) })}</span>
          <span>${t("posts.workingHours", { hours: post.task.working_hours })}</span>
          <span>${t("posts.applyDeadline", { deadline: formatTime(post.task.apply_deadline) })}</span>
          <span>${t("posts.applicantCount", { count: String(post.task.applicant_count || 0) })}</span>
        </div>
      `
        : "";
    const tagName = getTagName(post.tag_id);
    const tagSummary = tagName ? `<span class="tag-chip">${tagName}</span>` : "";
    card.innerHTML = `
    <div class="post-header">
      <div class="post-author">
        <a href="${profileUrl(post.user_id)}"><img class="avatar-sm" src="${avatar}" alt="${post.username}" /></a>
        ${authorLabel}
      </div>
      <div class="post-time">${tagSummary}${tagSummary ? " · " : ""}${formatTime(post.created_at)}</div>
    </div>
    <div class="post-content">${post.content}</div>
    ${taskSummary}
    <div class="post-images">${images}</div>
    ${videoSection}
    <div class="post-actions">
      <button class="btn-inline btn-secondary like-btn" type="button">
        ${post.liked_by_me ? t("posts.liked") : t("posts.like")} · ${post.like_count}
      </button>
      <button class="btn-inline btn-secondary view-details-btn" type="button" data-post-id="${post.id}">${t("posts.viewDetails")}</button>
      ${canDelete ? `<button class="btn-inline btn-secondary delete-post-btn" type="button">${t("posts.deletePost")}</button>` : ""}
    </div>
  `;
    const likeBtn = query(card, ".like-btn");
    const viewBtn = query(card, ".view-details-btn");
    const deleteBtn = card.querySelector(".delete-post-btn");
    enhancePostVideos(card);
    enhancePostImages(card);
    viewBtn.addEventListener("click", () => {
        window.location.href = `/post.html?id=${post.id}`;
    });
    likeBtn.addEventListener("click", async () => {
        const method = post.liked_by_me ? "DELETE" : "POST";
        const res = await fetch(`${API_BASE}/api/posts/${post.id}/like`, {
            method,
            credentials: "include",
        });
        if (!res.ok) {
            return;
        }
        post.liked_by_me = !post.liked_by_me;
        post.like_count += post.liked_by_me ? 1 : -1;
        likeBtn.textContent = `${post.liked_by_me ? t("posts.liked") : t("posts.like")} · ${post.like_count}`;
    });
    if (deleteBtn) {
        let pendingDelete = false;
        const actionsDiv = query(card, ".post-actions");
        const renderDeleteActions = () => {
            if (pendingDelete) {
                deleteBtn.textContent = t("common.confirmDelete");
                deleteBtn.classList.add("btn-danger");
                if (!actionsDiv.querySelector(".cancel-delete-btn")) {
                    const cancelBtn = document.createElement("button");
                    cancelBtn.className = "btn-inline btn-secondary cancel-delete-btn";
                    cancelBtn.type = "button";
                    cancelBtn.textContent = t("common.cancel");
                    cancelBtn.addEventListener("click", () => {
                        pendingDelete = false;
                        cancelBtn.remove();
                        deleteBtn.textContent = t("posts.deletePost");
                        deleteBtn.classList.remove("btn-danger");
                    });
                    actionsDiv.appendChild(cancelBtn);
                }
            }
        };
        deleteBtn.addEventListener("click", async () => {
            if (!pendingDelete) {
                pendingDelete = true;
                renderDeleteActions();
                return;
            }
            deleteBtn.disabled = true;
            const res = await fetch(`${API_BASE}/api/posts/${post.id}`, {
                method: "DELETE",
                credentials: "include",
            });
            if (!res.ok) {
                deleteBtn.disabled = false;
                return;
            }
            card.remove();
            if (!postList.querySelector(".post-card")) {
                postList.innerHTML = `<div class='post-empty'>${t("posts.noPosts")}</div>`;
            }
        });
    }
    return card;
}
async function loadPosts(reset = false) {
    if (reset) {
        nextOffset = 0;
        hasMore = true;
        postList.innerHTML = "";
    }
    if (!hasMore) {
        return;
    }
    const params = new URLSearchParams({
        limit: "10",
        offset: String(nextOffset),
        post_type: currentTagFilter ? "all" : currentPostTypeFilter,
    });
    if (currentTagFilter) {
        params.set("tag_id", String(currentTagFilter));
    }
    const res = await fetch(`${API_BASE}/api/posts?${params.toString()}`, {
        credentials: "include",
    });
    if (!res.ok) {
        postList.innerHTML = `<div class='post-empty'>${t("posts.loadFailed")}</div>`;
        return;
    }
    const data = await res.json();
    const posts = data.posts || [];
    if (reset && posts.length === 0) {
        postList.innerHTML = `<div class='post-empty'>${t("posts.noPosts")}</div>`;
        hasMore = false;
        postLoadMoreBtn.style.display = "none";
        return;
    }
    posts.forEach((post) => {
        postList.appendChild(createPostCard(post));
    });
    hasMore = Boolean(data.has_more);
    nextOffset = Number(data.next_offset || 0);
    postLoadMoreBtn.style.display = hasMore ? "inline-flex" : "none";
}
postLoadMoreBtn.addEventListener("click", () => {
    void loadPosts(false);
});
async function init() {
    await hydrateSiteBrand();
    await loadProfile();
    await loadTags();
    await loadPosts(true);
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
