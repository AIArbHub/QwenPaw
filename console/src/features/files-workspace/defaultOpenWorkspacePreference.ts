/**
 * User preference for whether the files workspace drawer should auto-open
 * when entering a new chat session.
 *
 * Defaults to off (closed): the workspace is only shown when the user opens
 * it manually or the user has explicitly opted into auto-open below.
 */
export const DEFAULT_OPEN_WORKSPACE_STORAGE_KEY =
  "aiarb-files-default-open-workspace";

/** True when the user has enabled auto-open for new chat sessions. */
export function isDefaultOpenWorkspaceEnabled(): boolean {
  try {
    return localStorage.getItem(DEFAULT_OPEN_WORKSPACE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Persist the auto-open preference. */
export function setDefaultOpenWorkspaceEnabled(value: boolean): void {
  try {
    localStorage.setItem(
      DEFAULT_OPEN_WORKSPACE_STORAGE_KEY,
      value ? "true" : "false",
    );
  } catch {
    // Ignore storage failures (e.g. private browsing).
  }
}