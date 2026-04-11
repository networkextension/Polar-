import { buildAssetUrl, resolveAvatar } from "./lib/avatar.js";
import { byId, query } from "./lib/dom.js";
import { hydrateSiteBrand, renderSidebarFoot } from "./lib/site.js";
import { bindThemeSync, initStoredTheme } from "./lib/theme.js";
import { fetchTags } from "./api/dashboard.js";
import { t } from "./lib/i18n.js";
import { logout } from "./api/session.js";

const API_BASE = "";
const postWelcome = byId<HTMLElement>("postWelcome");
const postList = byId<HTMLElement>("postList");
const postLoadMoreBtn = byId<HTMLButtonElement>("postLoadMoreBtn");
const postTypeFilters = byId<HTMLElement>("postTypeFilters");
const tagFilters = byId<HTMLElement>("tagFilters");
const postListBadge = byId<HTMLElement>("postListBadge");

type VideoItem = {
  url: string;
  poster_url?: string;
};

type ImageItem = {
  original_url: string;
  medium_url?: string;
  small_url?: string;
};

type Reply = {
  username: string;
  user_icon?: string;
  created_at: string;
  content: string;
};

type Post = {
  id: number;
  user_id: string;
  username: string;
  user_icon?: string;
  tag_id?: number | null;
  post_type?: string;
  created_at: string;
  content: string;
  images?: string[];
  image_items?: ImageItem[];
  videos?: string[];
  video_items?: VideoItem[];
  liked_by_me: boolean;
  like_count: number;
  task?: {
    location?: string;
    start_at: string;
    end_at: string;
    working_hours: string;
    apply_deadline: string;
    application_status: string;
    applicant_count?: number;
  };
};

type Tag = {
  id: number;
  name: string;
  slug: string;
};

let nextOffset = 0;
let hasMore = true;
let currentUserId = "";
let currentUserRole = "user";
let videoModal: HTMLDivElement | null = null;
let videoModalPlayer: HTMLVideoElement | null = null;
let imageModal: HTMLDivElement | null = null;
let imageModalViewer: HTMLImageElement | null = null;
let imageModalCounter: HTMLDivElement | null = null;
let imageModalPrevBtn: HTMLButtonElement | null = null;
let imageModalNextBtn: HTMLButtonElement | null = null;
let currentImageGallery: string[] = [];
let currentImageIndex = 0;
let currentPostTypeFilter: "all" | "standard" | "task" = "all";
let currentTagFilter: number | null = null;
let currentTags: Tag[] = [];

initStoredTheme();
bindThemeSync();

function formatTime(value: string): string {
  return new Date(value).toLocaleString();
}

function profileUrl(userId: string): string {
  return `/profile.html?user_id=${encodeURIComponent(userId)}`;
}

function getTagName(tagId?: number | null): string {
  if (!tagId) {
    return "";
  }
  return currentTags.find((item) => item.id === tagId)?.name || "";
}

function updateListBadge(): void {
  if (currentTagFilter) {
    postListBadge.textContent = getTagName(currentTagFilter) || t("posts.sectionPosts");
    return;
  }
  postListBadge.textContent =
    currentPostTypeFilter === "task" ? t("posts.gigTasks") : currentPostTypeFilter === "standard" ? t("posts.regularPosts") : t("posts.latestPosts");
}

function renderTypeFilters(): void {
  const items: Array<{ label: string; value: "all" | "standard" | "task" }> = [
    { label: t("posts.filterLatest"), value: "all" },
    { label: t("posts.filterRegular"), value: "standard" },
    { label: t("posts.filterGigs"), value: "task" },
  ];
  postTypeFilters.innerHTML = items
    .map(
      (item) =>
        `<button class="btn-inline btn-secondary post-filter-btn ${currentPostTypeFilter === item.value && !currentTagFilter ? "active" : ""}" data-post-type="${item.value}" type="button">${item.label}</button>`
    )
    .join("");
  postTypeFilters.querySelectorAll<HTMLButtonElement>(".post-filter-btn").forEach((button) => {
    button.addEventListener("click", async () => {
      currentPostTypeFilter = (button.dataset.postType as "all" | "standard" | "task") || "all";
      currentTagFilter = null;
      renderTypeFilters();
      renderTagFilters();
      updateListBadge();
      await loadPosts(true);
    });
  });
}

function renderTagFilters(): void {
  tagFilters.innerHTML = currentTags
    .map(
      (tag) =>
        `<button class="tag-chip post-tag-filter ${currentTagFilter === tag.id ? "active" : ""}" data-tag-id="${tag.id}" type="button">${tag.name}</button>`
    )
    .join("");
  tagFilters.querySelectorAll<HTMLButtonElement>(".post-tag-filter").forEach((button) => {
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

async function loadTags(): Promise<void> {
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

function ensureImageModal(): void {
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
  imageModalViewer = query<HTMLImageElement>(modal, ".image-modal-viewer");
  imageModalCounter = query<HTMLDivElement>(modal, ".image-modal-counter");
  imageModalPrevBtn = query<HTMLButtonElement>(modal, ".image-modal-prev");
  imageModalNextBtn = query<HTMLButtonElement>(modal, ".image-modal-next");

  const close = (): void => {
    if (!imageModal || !imageModalViewer) {
      return;
    }
    imageModal.classList.remove("open");
    imageModalViewer.removeAttribute("src");
    currentImageGallery = [];
    currentImageIndex = 0;
  };

  query<HTMLElement>(modal, ".image-modal-backdrop").addEventListener("click", close);
  query<HTMLButtonElement>(modal, ".image-modal-close").addEventListener("click", close);
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

function renderImageModal(): void {
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

function openImageModal(images: string[], index: number): void {
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

function stepImageModal(step: number): void {
  if (!currentImageGallery.length) {
    return;
  }
  currentImageIndex += step;
  renderImageModal();
}

function enhancePostImages(container: ParentNode): void {
  container.querySelectorAll<HTMLImageElement>(".post-images img").forEach((imageEl) => {
    imageEl.addEventListener("click", (event) => {
      event.stopPropagation();
      const siblings = Array.from((imageEl.closest(".post-images") as HTMLElement).querySelectorAll<HTMLImageElement>("img"));
      const gallery = siblings.map((el) => el.dataset.original || el.src);
      const index = siblings.indexOf(imageEl);
      openImageModal(gallery, index);
    });
  });
}

function ensureVideoModal(): void {
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
  videoModalPlayer = query<HTMLVideoElement>(modal, ".video-modal-player");

  const close = (): void => {
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

  query<HTMLElement>(modal, ".video-modal-backdrop").addEventListener("click", close);
  query<HTMLButtonElement>(modal, ".video-modal-close").addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      close();
    }
  });
}

function openVideoModal(url: string): void {
  if (!url) {
    return;
  }
  ensureVideoModal();
  if (!videoModal || !videoModalPlayer) {
    return;
  }
  videoModalPlayer.src = url;
  videoModal.classList.add("open");
  void videoModalPlayer.play().catch(() => {});
}

function normalizeVideoItems(post: Post): Array<{ url: string; posterUrl: string }> {
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

function normalizePostImages(post: Post, variant: "small" | "medium" | "original"): string[] {
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

function enhancePostVideos(container: ParentNode): void {
  container.querySelectorAll<HTMLVideoElement>(".post-videos video").forEach((videoEl) => {
    videoEl.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const source = videoEl.querySelector<HTMLSourceElement>("source");
      const src = videoEl.currentSrc || source?.src || "";
      videoEl.pause();
      openVideoModal(src);
    });
  });
}

async function loadProfile(): Promise<void> {
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

function createPostCard(post: Post): HTMLElement {
  const card = document.createElement("div");
  card.className = "post-card panel";

  const smallImages = normalizePostImages(post, "small");
  const origImages = normalizePostImages(post, "original");
  const images = smallImages
    .map((url, i) => `<img src="${url}" data-original="${origImages[i] ?? url}" alt="post image" loading="lazy" />`)
    .join("");
  const videos = normalizeVideoItems(post)
    .map(
      (item) => `
        <video controls preload="metadata" ${item.posterUrl ? `poster="${item.posterUrl}"` : ""}>
          <source src="${item.url}" />
          ${t("posts.videoNotSupported")}
        </video>
      `
    )
    .join("");
  const videoSection = videos ? `<div class="post-videos">${videos}</div>` : "";

  const isSelf = currentUserId && post.user_id === currentUserId;
  const canDelete = currentUserRole === "admin" || isSelf;
  const authorLabel = `<a class="post-author-name" href="${profileUrl(post.user_id)}">${post.username}</a>`;

  const avatar = resolveAvatar(post.username, post.user_icon, 64);
  const taskSummary =
    post.post_type === "task" && post.task
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

  const likeBtn = query<HTMLButtonElement>(card, ".like-btn");
  const viewBtn = query<HTMLButtonElement>(card, ".view-details-btn");
  const deleteBtn = card.querySelector<HTMLButtonElement>(".delete-post-btn");
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
    const actionsDiv = query<HTMLElement>(card, ".post-actions");

    const renderDeleteActions = (): void => {
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

async function loadPosts(reset = false): Promise<void> {
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
  const posts: Post[] = data.posts || [];
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

async function init(): Promise<void> {
  await hydrateSiteBrand();
  await loadProfile();
  await loadTags();
  await loadPosts(true);
}

void init();

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", async () => {
  try { await logout(); } finally { window.location.replace("/login.html"); }
});

