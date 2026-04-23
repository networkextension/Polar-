import { requestJson } from "./http.js";

export type ProfileRecommendation = {
  id: number;
  target_user_id: string;
  author_user_id: string;
  author_username: string;
  author_user_icon?: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type UserProfileDetail = {
  user_id: string;
  username: string;
  email?: string;
  icon_url?: string;
  bio?: string;
  created_at: string;
  is_me: boolean;
  can_recommend: boolean;
  i_blocked_user?: boolean;
  blocked_me?: boolean;
  is_following?: boolean;
  followed_me?: boolean;
  follower_count?: number;
  following_count?: number;
  recommendations?: ProfileRecommendation[];
};

export type UserProfileResponse = {
  profile?: UserProfileDetail;
  message?: string;
  error?: string;
};

export type UserSummary = {
  id: string;
  username: string;
  user_icon?: string;
  bio?: string;
  is_following?: boolean;
};

export type UserListResponse = {
  users?: UserSummary[];
  total?: number;
  has_more?: boolean;
  next_offset?: number;
  message?: string;
  error?: string;
};

export async function fetchUserProfile(userId: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/profile`);
}

export async function updateMyProfile(bio: string) {
  return requestJson<UserProfileResponse>("/api/users/me/profile", {
    method: "PUT",
    body: { bio },
  });
}

export async function upsertRecommendation(userId: string, content: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/recommendations`, {
    method: "POST",
    body: { content },
  });
}

export async function blockUser(userId: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/block`, {
    method: "POST",
  });
}

export async function unblockUser(userId: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/block`, {
    method: "DELETE",
  });
}

export async function followUser(userId: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/follow`, {
    method: "POST",
  });
}

export async function unfollowUser(userId: string) {
  return requestJson<UserProfileResponse>(`/api/users/${encodeURIComponent(userId)}/follow`, {
    method: "DELETE",
  });
}

export async function fetchFollowers(userId: string, limit = 20, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson<UserListResponse>(
    `/api/users/${encodeURIComponent(userId)}/followers?${params.toString()}`
  );
}

export async function fetchFollowing(userId: string, limit = 20, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson<UserListResponse>(
    `/api/users/${encodeURIComponent(userId)}/following?${params.toString()}`
  );
}
