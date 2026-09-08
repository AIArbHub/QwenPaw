import type { FileSource, FileTarget } from "./types";

/**
 * Editor tab identity encoding.
 *
 * `workspace` tabs keep their root-prefixed form (see FilesWorkspace) while
 * every other source uses `source::path`. Files that belong to another agent
 * insert that agent before the path — `source::agentId::path` — because two
 * agents can hold a file with the same relative path and would otherwise
 * share one tab and one dirty buffer.
 *
 * Agents with no explicit id encode exactly as before, so persisted tabs from
 * older sessions keep resolving.
 */
export function encodeTabPath(
  source: FileSource,
  path: string,
  agentId?: string,
): string {
  return agentId ? `${source}::${agentId}::${path}` : `${source}::${path}`;
}

export interface DecodedTabPath {
  source: FileSource;
  path: string;
  agentId?: string;
}

/**
 * Inverse of {@link encodeTabPath}. Bare paths (no `source::` prefix) are the
 * legacy workspace form.
 */
export function decodeTabPath(tabPath: string): DecodedTabPath {
  const separator = tabPath.indexOf("::");
  if (separator < 0) {
    return { source: "workspace", path: tabPath };
  }
  const source = tabPath.slice(0, separator) as FileSource;
  const rest = tabPath.slice(separator + 2);
  // Only an explicit agent slot introduces a second separator.
  const agentSeparator = rest.indexOf("::");
  if (agentSeparator < 0) return { source, path: rest };
  return {
    source,
    agentId: rest.slice(0, agentSeparator),
    path: rest.slice(agentSeparator + 2),
  };
}

/** Resolve the target recorded for a tab, falling back to its encoded path. */
export function targetForTab(
  tabPath: string,
  remembered: FileTarget | undefined,
  fallback: Pick<FileTarget, "root" | "artifactUrl"> = {},
): FileTarget {
  if (remembered) return remembered;
  const decoded = decodeTabPath(tabPath);
  return {
    source: decoded.source,
    path: decoded.path,
    agentId: decoded.agentId,
    root: fallback.root,
    artifactUrl: fallback.artifactUrl,
  };
}
