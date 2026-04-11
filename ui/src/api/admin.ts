import { requestJson } from "./http.js";
import type {
  AdminPasswordUpdateResponse,
  AdminUserListResponse,
  AdminUserLoginHistoryResponse,
} from "../types/admin.js";

export async function fetchAdminUsers(q = "", limit = 20, offset = 0) {
  const query = new URLSearchParams({
    q,
    limit: String(limit),
    offset: String(offset),
  });
  return requestJson<AdminUserListResponse>(`/api/admin/users?${query.toString()}`);
}

export async function fetchAdminUserLoginHistory(userID: string, limit = 20) {
  return requestJson<AdminUserLoginHistoryResponse>(
    `/api/admin/users/${encodeURIComponent(userID)}/login-history?limit=${limit}`
  );
}

export async function updateAdminUserPassword(userID: string, newPassword: string) {
  return requestJson<AdminPasswordUpdateResponse>(`/api/admin/users/${encodeURIComponent(userID)}/password`, {
    method: "PUT",
    body: {
      new_password: newPassword,
    },
  });
}

