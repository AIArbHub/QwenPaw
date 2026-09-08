import type { DirectoryEntry, FileSource } from "./types";

export interface MemoryTreeEntry extends DirectoryEntry {
  children?: MemoryTreeEntry[];
  /**
   * Source this node belongs to. Only populated by mixed views that merge
   * several file sources into one tree (e.g. global KB + per-agent KBs);
   * single-source trees leave it undefined and fall back to the navigator's
   * active source.
   */
  source?: FileSource;
  /** Owning agent, required to read/write nodes coming from another agent. */
  agentId?: string;
  /** Short trailing label describing the owning library. */
  badge?: string;
}

const DAILY_FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.md$/;
const DAILY_DIRECTORY_PATTERN = /^(\d{4}-\d{2}-\d{2})$/;

function modifiedTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function buildMemoryTree(files: DirectoryEntry[]): MemoryTreeEntry[] {
  return buildGenericTree(files.filter((file) => file.path.toLowerCase().endsWith(".md")));
}

/**
 * Build a file tree from arbitrary files (not just .md).
 * Used by the shared knowledge base view which can contain .txt, .md, etc.
 */
export function buildKnowledgeTree(files: DirectoryEntry[]): MemoryTreeEntry[] {
  return buildGenericTree(files);
}

function buildGenericTree(files: DirectoryEntry[]): MemoryTreeEntry[] {
  const root: MemoryTreeEntry[] = [];

  files
    .forEach((file) => {
      const parts = file.path.split("/").filter(Boolean);
      let entries = root;
      parts.forEach((part, index) => {
        const path = parts.slice(0, index + 1).join("/");
        const isFile = index === parts.length - 1;
        if (isFile) {
          entries.push({ ...file, name: part, path });
          return;
        }
        let directory = entries.find(
          (entry) => entry.kind === "directory" && entry.name === part,
        );
        if (!directory) {
          directory = {
            name: part,
            path,
            kind: "directory",
            size: null,
            modified_at: file.modified_at,
            preview_kind: "text",
            children: [],
          };
          entries.push(directory);
        } else if (
          modifiedTimestamp(file.modified_at) >
          modifiedTimestamp(directory.modified_at)
        ) {
          directory.modified_at = file.modified_at;
        }
        entries = directory.children ?? [];
      });
    });

  const sortEntries = (entries: MemoryTreeEntry[]) => {
    entries.sort((left, right) => {
      const modifiedDifference =
        modifiedTimestamp(right.modified_at) -
        modifiedTimestamp(left.modified_at);
      if (modifiedDifference !== 0) return modifiedDifference;
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
    entries.forEach((entry) => {
      if (entry.children) sortEntries(entry.children);
    });
  };
  sortEntries(root);
  return root;
}

/** Fields stamped onto every node of a merged subtree. */
export interface TreeSourceStamp {
  source?: FileSource;
  agentId?: string;
  badge?: string;
}

export interface TreeGroupInput extends TreeSourceStamp {
  /** Visible label of the library node. */
  name: string;
  /** Synthetic unique path for the group node, e.g. `library:global`. */
  path: string;
  entries: DirectoryEntry[];
}

/**
 * Build a tree whose top level is a fixed list of libraries, each nesting the
 * file tree of a distinct source. Used by the knowledge-base page's aggregate
 * view, which must keep every library separately identifiable while sharing a
 * single navigator.
 *
 * Group paths are synthetic (`library:<key>`) because a library is not itself
 * a directory on disk — but every descendant keeps its real relative path so
 * read/write APIs still resolve.
 */
export function buildGroupedTree(groups: TreeGroupInput[]): MemoryTreeEntry[] {
  return groups.map((group) => {
    const children = stampSubtree(buildGenericTree(group.entries), group);
    const latest = children.reduce(
      (acc, entry) =>
        modifiedTimestamp(entry.modified_at) > modifiedTimestamp(acc)
          ? entry.modified_at
          : acc,
      "",
    );
    return {
      name: group.name,
      path: group.path,
      kind: "directory",
      size: null,
      modified_at: latest,
      preview_kind: "text",
      children,
      source: group.source,
      agentId: group.agentId,
      badge: group.badge,
    };
  });
}

/** Stamp every descendant of a tree with source/agent/badge metadata. */
export function stampSubtree(
  entries: MemoryTreeEntry[],
  stamp: TreeSourceStamp,
): MemoryTreeEntry[] {
  return entries.map((entry) => ({
    ...entry,
    source: entry.source ?? stamp.source,
    agentId: entry.agentId ?? stamp.agentId,
    badge: entry.badge ?? stamp.badge,
    children: entry.children
      ? stampSubtree(entry.children, stamp)
      : entry.children,
  }));
}

export function buildDailyMemoryTree(
  files: DirectoryEntry[],
): MemoryTreeEntry[] {
  const tree = buildMemoryTree(files);
  const dateGroups = new Map<
    string,
    { file?: MemoryTreeEntry; directory?: MemoryTreeEntry }
  >();
  const otherEntries: MemoryTreeEntry[] = [];

  tree.forEach((entry) => {
    const match =
      entry.kind === "file"
        ? entry.name.match(DAILY_FILE_PATTERN)
        : entry.name.match(DAILY_DIRECTORY_PATTERN);
    if (!match) {
      otherEntries.push(entry);
      return;
    }

    const date = match[1];
    const group = dateGroups.get(date) ?? {};
    if (entry.kind === "file") group.file = entry;
    else group.directory = entry;
    dateGroups.set(date, group);
  });

  const dailyEntries = Array.from(dateGroups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([, group]) => {
      if (!group.file) return group.directory as MemoryTreeEntry;
      if (!group.directory) return group.file;

      return {
        ...group.directory,
        modified_at:
          modifiedTimestamp(group.file.modified_at) >
          modifiedTimestamp(group.directory.modified_at)
            ? group.file.modified_at
            : group.directory.modified_at,
        children: [group.file, ...(group.directory.children ?? [])],
      };
    });

  return [...dailyEntries, ...otherEntries];
}
