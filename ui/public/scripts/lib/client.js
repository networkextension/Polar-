export function getClientDeviceType() {
    return "browser";
}
export function getStoredPushToken() {
    try {
        return window.localStorage.getItem("push_token")?.trim() || "";
    }
    catch {
        return "";
    }
}
export function buildClientHeaders(headers = {}) {
    const merged = new Headers(headers);
    merged.set("X-Device-Type", getClientDeviceType());
    const pushToken = getStoredPushToken();
    if (pushToken) {
        merged.set("X-Push-Token", pushToken);
    }
    return merged;
}
export function formatDeviceType(deviceType) {
    switch (deviceType) {
        case "ios":
            return "iOS";
        case "android":
            return "Android";
        default:
            return "浏览器";
    }
}
