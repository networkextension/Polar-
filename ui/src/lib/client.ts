export function getClientDeviceType(): string {
  return "browser";
}

export function getStoredPushToken(): string {
  try {
    return window.localStorage.getItem("push_token")?.trim() || "";
  } catch {
    return "";
  }
}

export function buildClientHeaders(headers: HeadersInit = {}): Headers {
  const merged = new Headers(headers);
  merged.set("X-Device-Type", getClientDeviceType());

  const pushToken = getStoredPushToken();
  if (pushToken) {
    merged.set("X-Push-Token", pushToken);
  }

  return merged;
}

export function formatDeviceType(deviceType?: string): string {
  switch (deviceType) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    default:
      return "浏览器";
  }
}
