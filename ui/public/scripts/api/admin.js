import { requestJson } from "./http.js";
export async function fetchAdminUsers(q = "", limit = 20, offset = 0) {
    const query = new URLSearchParams({
        q,
        limit: String(limit),
        offset: String(offset),
    });
    return requestJson(`/api/admin/users?${query.toString()}`);
}
export async function fetchAdminUserLoginHistory(userID, limit = 20) {
    return requestJson(`/api/admin/users/${encodeURIComponent(userID)}/login-history?limit=${limit}`);
}
export async function updateAdminUserPassword(userID, newPassword) {
    return requestJson(`/api/admin/users/${encodeURIComponent(userID)}/password`, {
        method: "PUT",
        body: {
            new_password: newPassword,
        },
    });
}
