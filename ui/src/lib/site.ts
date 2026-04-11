import { makeDefaultAvatar } from "./avatar.js";
import { applyI18n, t } from "./i18n.js";

type SiteSettings = {
  name?: string;
  description?: string;
  icon_url?: string;
};

type SidebarUser = {
  username?: string;
  role?: string;
  icon_url?: string;
};

const fallbackSite: Required<SiteSettings> = {
  name: "Polar-",
  description: "AI-assisted product prototyping workspace",
  icon_url: "",
};

function resolveSite(site?: SiteSettings): Required<SiteSettings> {
  return {
    name: site?.name?.trim() || fallbackSite.name,
    description: site?.description?.trim() || fallbackSite.description,
    icon_url: site?.icon_url || "",
  };
}

export function renderSiteBrand(site?: SiteSettings): void {
  const safeSite = resolveSite(site);
  const iconSrc = safeSite.icon_url || makeDefaultAvatar(safeSite.name, 160);

  document.querySelectorAll<HTMLElement>("[data-site-brand]").forEach((container) => {
    const nameEl = container.querySelector<HTMLElement>("[data-site-name]");
    const descEl = container.querySelector<HTMLElement>("[data-site-description]");
    const iconEl = container.querySelector<HTMLImageElement>("[data-site-icon]");

    if (nameEl) {
      nameEl.textContent = safeSite.name;
    }
    if (descEl) {
      descEl.textContent = safeSite.description;
    }
    if (iconEl) {
      iconEl.src = iconSrc;
      iconEl.alt = `${safeSite.name} ${t("brand.icon")}`;
    }
  });
}

const SIDEBAR_COLLAPSED_KEY = "lp_sidebar_collapsed";

export function initSidebarToggle(): void {
  const topbar = document.querySelector<HTMLElement>(".lp-topbar");
  const app = document.querySelector<HTMLElement>(".lp-app");
  if (!topbar || !app) {
    return;
  }
  if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
    app.classList.add("sidebar-collapsed");
  }
  const btn = document.createElement("button");
  btn.className = "lp-sidebar-toggle";
  btn.title = "Toggle sidebar";
  btn.setAttribute("aria-label", "Toggle sidebar");
  btn.textContent = "☰";
  btn.addEventListener("click", () => {
    const collapsed = app.classList.toggle("sidebar-collapsed");
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  });
  topbar.insertBefore(btn, topbar.firstChild);
}

export async function hydrateSiteBrand(): Promise<void> {
  applyI18n();
  initSidebarToggle();
  await hydrateSidebarFoot();

  if (!document.querySelector("[data-site-brand]")) {
    return;
  }

  try {
    const response = await fetch("/api/site-settings", { credentials: "include" });
    if (!response.ok) {
      renderSiteBrand();
      return;
    }
    const data = await response.json();
    renderSiteBrand(data.site);
  } catch {
    renderSiteBrand();
  }
}

export function renderSidebarFoot(user?: SidebarUser): void {
  const nameEl = document.getElementById("lpFootName");
  const roleEl = document.getElementById("lpFootRole");
  const avatarEl = document.getElementById("lpFootAvatar");

  if (!nameEl && !roleEl && !avatarEl) {
    return;
  }

  const username = (user?.username || "").trim();
  if (nameEl) {
    nameEl.textContent = username || "—";
  }
  if (roleEl) {
    roleEl.textContent = user?.role === "admin" ? "Administrator" : "Member";
  }
  if (avatarEl) {
    const avatar = username ? username.slice(0, 1).toUpperCase() : "U";
    if (user?.icon_url) {
      avatarEl.style.backgroundImage = `url(${user.icon_url})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.textContent = "";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.style.backgroundSize = "";
      avatarEl.style.backgroundPosition = "";
      avatarEl.textContent = avatar;
    }
  }
}

export async function hydrateSidebarFoot(): Promise<void> {
  const hasFoot = document.getElementById("lpFootName") || document.getElementById("lpFootRole") || document.getElementById("lpFootAvatar");
  if (!hasFoot) {
    return;
  }

  try {
    const response = await fetch("/api/me", { credentials: "include" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    renderSidebarFoot(data);
  } catch {
    // Keep static placeholders on network failure.
  }
}
