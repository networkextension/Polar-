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
  recommendations?: ProfileRecommendation[];
};

export type UserProfileResponse = {
  profile?: UserProfileDetail;
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
