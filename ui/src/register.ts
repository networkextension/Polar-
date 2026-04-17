import { byId } from "./lib/dom.js";
import { buildClientHeaders } from "./lib/client.js";
import { hydrateSiteBrand } from "./lib/site.js";
import { t } from "./lib/i18n.js";

const API_BASE = "";
const form = byId<HTMLFormElement>("registerForm");
const alertBox = byId<HTMLElement>("alert");
const inviteCodeWrap = byId<HTMLElement>("inviteCodeWrap");
const inviteCodeInput = byId<HTMLInputElement>("invitation_code");

type RegisterFormElements = HTMLFormControlsCollection & {
  username: HTMLInputElement;
  email: HTMLInputElement;
  password: HTMLInputElement;
  invitation_code: HTMLInputElement;
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  alertBox.className = "alert";
  alertBox.textContent = "";

  const elements = form.elements as RegisterFormElements;
  const payload = {
    username: elements.username.value.trim(),
    email: elements.email.value.trim(),
    password: elements.password.value,
    invitation_code: elements.invitation_code?.value.trim() || "",
  };

  try {
    const res = await fetch(`${API_BASE}/api/register`, {
      method: "POST",
      headers: buildClientHeaders({ "Content-Type": "application/json" }),
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      alertBox.className = "alert error";
      alertBox.textContent = data.error || t("register.failed");
      return;
    }

    alertBox.className = "alert success";
    alertBox.textContent = t("register.success");
    window.setTimeout(() => {
      window.location.href = "/dashboard.html";
    }, 600);
  } catch {
    alertBox.className = "alert error";
    alertBox.textContent = t("common.networkError");
  }
});

async function redirectIfLoggedIn(): Promise<void> {
  try {
    const res = await fetch("/api/me", { credentials: "include" });
    if (res.ok) {
      window.location.replace("/dashboard.html");
    }
  } catch {
    // Ignore bootstrap failures here.
  }
}

void redirectIfLoggedIn();

async function loadInviteRequirement(): Promise<void> {
  try {
    const response = await fetch("/api/site-settings", { credentials: "include" });
    if (!response.ok) {
      inviteCodeWrap.hidden = true;
      inviteCodeInput.required = false;
      return;
    }
    const data = await response.json();
    const required = Boolean(data?.site?.registration_requires_invite);
    inviteCodeWrap.hidden = !required;
    inviteCodeInput.required = required;
  } catch {
    inviteCodeWrap.hidden = true;
    inviteCodeInput.required = false;
  }
}

void hydrateSiteBrand();
void loadInviteRequirement();
