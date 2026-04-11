import { makeDefaultAvatar } from "./avatar.js";
import { applyI18n, t } from "./i18n.js";
const fallbackSite = {
    name: "Polar-",
    description: "AI-assisted product prototyping workspace",
    icon_url: "",
};
function resolveSite(site) {
    return {
        name: site?.name?.trim() || fallbackSite.name,
        description: site?.description?.trim() || fallbackSite.description,
        icon_url: site?.icon_url || "",
    };
}
export function renderSiteBrand(site) {
    const safeSite = resolveSite(site);
    const iconSrc = safeSite.icon_url || makeDefaultAvatar(safeSite.name, 160);
    document.querySelectorAll("[data-site-brand]").forEach((container) => {
        const nameEl = container.querySelector("[data-site-name]");
        const descEl = container.querySelector("[data-site-description]");
        const iconEl = container.querySelector("[data-site-icon]");
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
export function hydrateSidebarFoot(username, role) {
    const avatar = document.getElementById("lpFootAvatar");
    const nameEl = document.getElementById("lpFootName");
    const roleEl = document.getElementById("lpFootRole");
    if (avatar) avatar.textContent = (username || "U")[0].toUpperCase();
    if (nameEl) nameEl.textContent = username || "—";
    if (roleEl) roleEl.textContent = role === "admin" ? "Administrator" : "Member";
}
const SIDEBAR_COLLAPSED_KEY = "lp_sidebar_collapsed";
export function initSidebarToggle() {
    const topbar = document.querySelector(".lp-topbar");
    const app = document.querySelector(".lp-app");
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
export async function hydrateCurrentUserFoot() {
    if (!document.getElementById("lpFootName")) {
        return;
    }
    try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (!res.ok) {
            return;
        }
        const data = await res.json();
        hydrateSidebarFoot(data.username, data.role);
    }
    catch {
        // not logged in or network error — leave placeholder
    }
}
export async function hydrateSiteBrand() {
    applyI18n();
    initSidebarToggle();
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
    }
    catch {
        renderSiteBrand();
    }
}
