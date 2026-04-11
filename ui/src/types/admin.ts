import type { LoginRecord } from "./dashboard.js";

export type AdminUserSummary = {
  id: string;
  username: string;
  email: string;
  role: string;
  is_online?: boolean;
  device_type?: string;
  last_seen_at?: string;
  created_at: string;
};

export type AdminUserListResponse = {
  users?: AdminUserSummary[];
  total?: number;
  has_more?: boolean;
  next_offset?: number;
  error?: string;
};

export type AdminUserLoginHistoryResponse = {
  records?: LoginRecord[];
  error?: string;
};

export type AdminPasswordUpdateResponse = {
  message?: string;
  user_id?: string;
  error?: string;
};

