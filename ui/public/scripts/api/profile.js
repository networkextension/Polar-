import { requestJson } from "./http.js";
export async function fetchUserProfile(userId) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/profile`);
}
export async function updateMyProfile(bio) {
    return requestJson("/api/users/me/profile", {
        method: "PUT",
        body: { bio },
    });
}
export async function upsertRecommendation(userId, content) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/recommendations`, {
        method: "POST",
        body: { content },
    });
}
export async function blockUser(userId) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/block`, {
        method: "POST",
    });
}
export async function unblockUser(userId) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/block`, {
        method: "DELETE",
    });
}
export async function followUser(userId) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/follow`, {
        method: "POST",
    });
}
export async function unfollowUser(userId) {
    return requestJson(`/api/users/${encodeURIComponent(userId)}/follow`, {
        method: "DELETE",
    });
}
export async function fetchFollowers(userId, limit = 20, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return requestJson(`/api/users/${encodeURIComponent(userId)}/followers?${params.toString()}`);
}
export async function fetchFollowing(userId, limit = 20, offset = 0) {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    return requestJson(`/api/users/${encodeURIComponent(userId)}/following?${params.toString()}`);
}
