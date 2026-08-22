export type CloudProviderType = "s3" | "webdav";

export interface S3Config {
  endpoint_url: string;
  region: string;
  bucket: string;
  access_key_id: string;
  secret_access_key: string;
  force_path_style: boolean;
}

export interface WebDAVConfig {
  url: string;
  username: string;
  password: string;
}

export interface CloudBackupConfig {
  provider: CloudProviderType | null;
  enabled: boolean;
  remote_prefix: string;
  auto_sync: boolean;
  sync_on_schedule: boolean;
  sync_schedule_cron: string;
  max_cloud_backups: number;
  s3: S3Config;
  webdav: WebDAVConfig;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
}

export interface CloudBackupEntry {
  key: string;
  size: number;
  last_modified: string;
  backup_name: string;
}

export interface CloudBackupListResponse {
  entries: CloudBackupEntry[];
}

export interface CloudSyncResponse {
  uploaded_count: number;
  entries: CloudBackupEntry[];
}
