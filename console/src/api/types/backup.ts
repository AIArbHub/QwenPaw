export interface BackupScope {
  include_agents: boolean;
  include_global_config: boolean;
  include_secrets: boolean;
  include_skill_pool: boolean;
  include_jobs: boolean;
  include_chats: boolean;
  include_plugins: boolean;
  include_browser_data: boolean;
}

export type BackupTrustMode = "legacy" | "foreign" | "portable";

export interface BackupMeta {
  id: string;
  name: string;
  description: string;
  created_at: string;
  scope: BackupScope;
  agent_count: number;
  signature?: string | null;
  accepted_via_trust?: boolean | null;
}

export interface BackupDetail extends BackupMeta {
  workspace_stats: Record<
    string,
    { files: number; size: number; name?: string }
  >;
}

export interface CreateBackupRequest {
  name: string;
  description?: string;
  scope: BackupScope;
  agents: string[];
  portable?: boolean;
  browser_data?: Record<string, unknown> | null;
}

export interface RestoreBackupRequest {
  include_agents: boolean;
  agent_ids: string[];
  include_global_config: boolean;
  include_secrets: boolean;
  include_skill_pool: boolean;
  include_jobs: boolean;
  include_chats: boolean;
  include_plugins: boolean;
  include_browser_data: boolean;
  default_workspace_dir?: string | null;
  mode?: "full" | "custom";
  preserve_local_protected_config?: boolean | null;
  trust_mode?: BackupTrustMode | null;
}

export interface RestoreBackupResponse {
  ok: boolean;
  preserved_local_keys: string[];
}

/**
 * Determine if a backup is a full backup.
 * A full backup must have all major data categories enabled.
 */
export function isFullBackup(scope: BackupScope): boolean {
  return (
    scope.include_agents === true &&
    scope.include_global_config === true &&
    scope.include_skill_pool === true &&
    scope.include_secrets === true &&
    scope.include_jobs === true &&
    scope.include_chats === true &&
    scope.include_plugins === true &&
    scope.include_browser_data === true
  );
}

export interface DeleteBackupsResponse {
  deleted: string[];
  failed: { id: string; reason: string }[];
}

export type BackupProgressEvent =
  | { type: "start"; total_agents: number; percent: 0 }
  | {
      type: "agent";
      agent_id: string;
      index: number;
      total: number;
      percent: number;
    }
  | { type: "saving"; percent: number }
  | { type: "done"; meta: BackupMeta; percent: 100 }
  | { type: "error"; message: string };

export interface BackupConflictResponse {
  detail: "backup_conflict";
  existing: BackupMeta;
  pending_token: string;
}

export interface BackupValidationDetail {
  code: string;
  message: string;
  locked_paths?: string[];
}

export interface BrowserDataPayload {
  docforgeTasks: unknown[];
  docforgeParseTasks: unknown[];
  messageQueues: Record<string, unknown[]>;
  preferences: BrowserPreferencesPayload;
}

export interface BrowserPreferencesPayload {
  theme: string | null;
  language: string | null;
  sidebarMode: string | null;
  lastUsedAgent: string | null;
  codingTabs: unknown | null;
  closeWindowAction: string | null;
}