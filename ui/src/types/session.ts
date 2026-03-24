export type UserProfile = {
  user_id: string;
  username: string;
  role?: string;
  icon_url?: string;
  bio?: string;
  is_online?: boolean;
  device_type?: string;
  last_seen_at?: string;
};
