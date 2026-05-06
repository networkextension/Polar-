export type IOSApp = {
  id: number;
  owner_user_id: string;
  name: string;
  bundle_id: string;
  description: string;
  icon_url: string;
  icon_source: "" | "ipa" | "manual";
  testflight_url: string;
  asc_app_id: string;
  asc_beta_group_id: string;
  public_slug: string;
  is_public: boolean;
  keywords: string;
  whats_new: string;
  promotional_text: string;
  marketing_url: string;
  support_url: string;
  created_at: string;
  updated_at: string;
};

export type IOSTestRequest = {
  id: number;
  app_id: number;
  email: string;
  first_name: string;
  last_name: string;
  status: "pending" | "sent" | "failed";
  asc_response: string;
  source_ip: string;
  user_agent: string;
  created_at: string;
  processed_at?: string | null;
};

export type IOSASCConfig = {
  owner_user_id: string;
  issuer_id: string;
  key_id: string;
  p8_filename: string;
  p8_encrypted: boolean;
  account_holder_email: string;
  team_name: string;
  created_at: string;
  updated_at: string;
};

export type IOSASCConfigStatusResponse = {
  configured: boolean;
  config?: IOSASCConfig;
  encryption_ready: boolean;
};

export type IOSASCApp = {
  id: string;
  bundle_id: string;
  name: string;
  sku: string;
};

export type IOSASCBetaGroup = {
  id: string;
  name: string;
  is_internal: boolean;
  public_link: string;
  public_link_enabled: boolean;
};

export type IOSDistType = "ad_hoc" | "enterprise" | "development" | "app_store";

export type IOSVersion = {
  id: number;
  app_id: number;
  version: string;
  build_number: string;
  ipa_url: string;
  ipa_filename: string;
  ipa_size: number;
  ipa_sha256: string;
  release_notes: string;
  is_signed: boolean;
  distribution_type: IOSDistType;
  ipa_bundle_id: string;
  ipa_short_version: string;
  ipa_build_number: string;
  ipa_display_name: string;
  ipa_min_os: string;
  ipa_has_embedded_profile: boolean;
  created_at: string;
};

export type IOSCertificate = {
  id: number;
  owner_user_id: string;
  name: string;
  kind: "distribution" | "development" | "enterprise" | "adhoc";
  file_url: string;
  file_filename: string;
  file_size: number;
  password_encrypted: boolean;
  has_password: boolean;
  team_id: string;
  common_name: string;
  notes: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type IOSProfile = {
  id: number;
  owner_user_id: string;
  name: string;
  kind: IOSDistType;
  file_url: string;
  file_filename: string;
  file_size: number;
  app_id: string;
  team_id: string;
  udid_count: number;
  notes: string;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type IOSCertificateListResponse = {
  certificates: IOSCertificate[] | null;
  encryption_ready: boolean;
};
export type IOSCertificateUploadResponse = { certificate: IOSCertificate };
export type IOSProfileListResponse = { profiles: IOSProfile[] | null };
export type IOSProfileUploadResponse = { profile: IOSProfile };

export type IOSAppListResponse = { apps: IOSApp[] | null };
export type IOSAppCreateResponse = { app: IOSApp };
export type IOSAppDetailResponse = { app: IOSApp; versions: IOSVersion[] | null };
export type IOSVersionUploadResponse = { version: IOSVersion };

export type IOSInstallTokenResponse = {
  token: string;
  expires_at: string;
  install_url: string;
  manifest_url: string;
  itms_services: string;
};
