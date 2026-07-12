/**
 * personaParser.ts — Markdown ↔ structured data bidirectional parser
 *
 * The md files (SOUL.md, PROFILE.md, AGENTS.md) are the single source of
 * truth. This module parses them into structured JavaScript objects for the
 * visual editor, and serializes structured objects back into md content.
 *
 * Design principles:
 * 1. Never lose data — unparseable sections are preserved as raw text.
 * 2. Never throw — parsing failures fall back gracefully.
 * 3. Multi-language section title matching (zh / en).
 * 4. Frontmatter (YAML between `---`) is preserved on round-trip.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedProfile {
  agent: {
    name: string;
    role: string;
    style: string;
    other: string;
  };
  user: {
    name: string;
    addressAs: string;
    pronouns: string;
    notes: string;
    background: string;
  };
  customSections: CustomSection[];
}

export interface ParsedSoul {
  intro: string;
  corePrinciples: string[];
  boundaries: string[];
  style: string;
  continuity: string;
  customSections: CustomSection[];
}

export interface ParsedAgents {
  safety: string[];
  internalActions: string[];
  externalActions: string[];
  toolGuidelines: string;
  heartbeatEnabled: boolean;
  heartbeatInterval: string;
  emojiSection: string;
  customSections: CustomSection[];
}

export interface CustomSection {
  title: string;
  content: string;
}

export interface ParsedPersona {
  profile: ParsedProfile;
  soul: ParsedSoul;
  agents: ParsedAgents;
}

// ─── Section title multilingual mapping ──────────────────────────────────────

const PROFILE_SECTIONS = {
  identity: ["身份", "Identity"],
  userProfile: ["用户资料", "User Profile"],
  background: ["背景", "Background"],
} as const;

const SOUL_SECTIONS = {
  corePrinciples: ["核心准则", "核心真理", "Core Truths", "Core Principles"],
  boundaries: ["边界", "Boundaries"],
  style: ["风格", "Vibe", "Style"],
  continuity: ["连续性", "Continuity"],
} as const;

const AGENTS_SECTIONS = {
  safety: ["安全", "Safety"],
  internalExternal: ["内部 vs 外部", "Internal vs External"],
  tools: ["工具", "Tools"],
  heartbeat: ["Heartbeats", "💓 Heartbeats", "心跳"],
  emoji: ["表情", "😊"],
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract frontmatter from md content.
 * Returns { frontmatter, body } where frontmatter is the raw YAML block
 * (including `---` delimiters) and body is the remaining content.
 */
export function extractFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    return {
      frontmatter: match[0],
      body: content.slice(match[0].length),
    };
  }
  return { frontmatter: "", body: content };
}

/**
 * Split markdown body into sections by `##` headings.
 * Returns an array of { title, level, content } where title is the heading
 * text (without `##`), level is 2, and content is the text until the next
 * heading of the same or higher level.
 */
interface MdSection {
  title: string;
  content: string;
}

function splitSections(body: string): MdSection[] {
  const lines = body.split("\n");
  const sections: MdSection[] = [];
  let currentTitle = "";
  let currentContent: string[] = [];
  let foundFirstHeading = false;

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (foundFirstHeading || currentContent.some((l) => l.trim())) {
        sections.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
        });
      }
      currentTitle = headingMatch[1].trim();
      currentContent = [];
      foundFirstHeading = true;
    } else {
      currentContent.push(line);
    }
  }
  if (foundFirstHeading || currentContent.some((l) => l.trim())) {
    sections.push({
      title: currentTitle,
      content: currentContent.join("\n").trim(),
    });
  }
  return sections;
}

/**
 * Check if a section title matches any of the candidate titles.
 */
function matchSection(
  title: string,
  candidates: readonly string[],
): boolean {
  const normalized = title.trim().toLowerCase();
  return candidates.some((c) => c.toLowerCase() === normalized);
}

/**
 * Extract list items from markdown content.
 * Each item is a line starting with `- ` (after stripping `**bold**` markers).
 */
function extractListItems(content: string): string[] {
  const items: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*[-*]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }
  return items;
}

/**
 * Extract a value from a line like "- **名字：** 小助" or "- **Name:** Value".
 * Returns the value after the bold label, or empty string.
 */
function extractLabeledValue(content: string, labels: string[]): string {
  for (const line of content.split("\n")) {
    for (const label of labels) {
      // Match: - **label**  value  OR  - **label：** value  OR  - **label:** value
      const re = new RegExp(
        `^\\s*[-*]\\s+\\*\\*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[:：]?\\*\\*\\s*(.*)$`,
      );
      const match = line.match(re);
      if (match && match[1].trim()) {
        // Remove italic markers and extra formatting
        return match[1]
          .trim()
          .replace(/^[*_]+|[*_]+$/g, "")
          .replace(/\*（.+?）\*/g, "")
          .trim();
      }
    }
  }
  return "";
}

/**
 * Extract raw text content (non-list, non-empty lines) from a section.
 */
function extractRawText(content: string): string {
  return content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith("-") && !trimmed.startsWith("*");
    })
    .join("\n")
    .trim();
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse PROFILE.md content into structured data.
 */
export function parseProfile(mdContent: string): ParsedProfile {
  const { body } = extractFrontmatter(mdContent);
  const sections = splitSections(body);
  const result: ParsedProfile = {
    agent: { name: "", role: "", style: "", other: "" },
    user: {
      name: "",
      addressAs: "",
      pronouns: "",
      notes: "",
      background: "",
    },
    customSections: [],
  };

  let inIdentity = false;
  let inUserProfile = false;

  for (const section of sections) {
    if (matchSection(section.title, PROFILE_SECTIONS.identity)) {
      inIdentity = true;
      inUserProfile = false;
      result.agent.name = extractLabeledValue(section.content, [
        "名字",
        "Name",
      ]);
      result.agent.role = extractLabeledValue(section.content, [
        "定位",
        "Nature",
        "Role",
      ]);
      result.agent.style = extractLabeledValue(section.content, [
        "风格",
        "Style",
      ]);
      result.agent.other = extractLabeledValue(section.content, [
        "其他",
        "Other",
      ]);
    } else if (matchSection(section.title, PROFILE_SECTIONS.userProfile)) {
      inIdentity = false;
      inUserProfile = true;
      result.user.name = extractLabeledValue(section.content, [
        "名字",
        "Name",
      ]);
      result.user.addressAs = extractLabeledValue(section.content, [
        "怎么叫他们",
        "Address as",
        "怎么称呼你",
      ]);
      result.user.pronouns = extractLabeledValue(section.content, [
        "代词",
        "Pronouns",
      ]);
      result.user.notes = extractLabeledValue(section.content, [
        "笔记",
        "Notes",
      ]);
    } else if (matchSection(section.title, PROFILE_SECTIONS.background)) {
      inIdentity = false;
      inUserProfile = false;
      result.user.background = extractRawText(section.content);
    } else if (section.title) {
      result.customSections.push({
        title: section.title,
        content: section.content,
      });
    }
  }

  return result;
}

/**
 * Parse SOUL.md content into structured data.
 */
export function parseSoul(mdContent: string): ParsedSoul {
  const { body } = extractFrontmatter(mdContent);
  const sections = splitSections(body);
  const result: ParsedSoul = {
    intro: "",
    corePrinciples: [],
    boundaries: [],
    style: "",
    continuity: "",
    customSections: [],
  };

  // Text before the first ## heading is the intro
  const firstHeadingIdx = body.search(/^##\s/m);
  if (firstHeadingIdx > 0) {
    result.intro = body.slice(0, firstHeadingIdx).trim();
  } else if (firstHeadingIdx === -1) {
    result.intro = body.trim();
  }

  for (const section of sections) {
    if (matchSection(section.title, SOUL_SECTIONS.corePrinciples)) {
      result.corePrinciples = extractListItems(section.content);
    } else if (matchSection(section.title, SOUL_SECTIONS.boundaries)) {
      result.boundaries = extractListItems(section.content);
    } else if (matchSection(section.title, SOUL_SECTIONS.style)) {
      result.style = extractRawText(section.content);
    } else if (matchSection(section.title, SOUL_SECTIONS.continuity)) {
      result.continuity = extractRawText(section.content);
    } else if (section.title) {
      result.customSections.push({
        title: section.title,
        content: section.content,
      });
    }
  }

  return result;
}

/**
 * Parse AGENTS.md content into structured data.
 */
export function parseAgents(mdContent: string): ParsedAgents {
  const { body } = extractFrontmatter(mdContent);
  const sections = splitSections(body);
  const result: ParsedAgents = {
    safety: [],
    internalActions: [],
    externalActions: [],
    toolGuidelines: "",
    heartbeatEnabled: false,
    heartbeatInterval: "",
    emojiSection: "",
    customSections: [],
  };

  for (const section of sections) {
    if (matchSection(section.title, AGENTS_SECTIONS.safety)) {
      result.safety = extractListItems(section.content);
    } else if (
      matchSection(section.title, AGENTS_SECTIONS.internalExternal)
    ) {
      // Split into "可以自由做的" / "先问一声" subsections
      const subSections = section.content.split(/^###\s/m);
      for (const sub of subSections) {
        const trimmed = sub.trim();
        if (!trimmed) continue;
        if (/自由|free|can/i.test(trimmed.split("\n")[0])) {
          result.internalActions = extractListItems(sub);
        } else if (/先问|ask|external/i.test(trimmed.split("\n")[0])) {
          result.externalActions = extractListItems(sub);
        }
      }
    } else if (matchSection(section.title, AGENTS_SECTIONS.tools)) {
      result.toolGuidelines = section.content.trim();
    } else if (matchSection(section.title, AGENTS_SECTIONS.heartbeat)) {
      result.heartbeatEnabled = true;
      const intervalMatch = section.content.match(
        /(\d+)\s*(分钟|minutes?|mins?|分)/,
      );
      if (intervalMatch) {
        result.heartbeatInterval = intervalMatch[1];
      }
    } else if (matchSection(section.title, AGENTS_SECTIONS.emoji)) {
      result.emojiSection = section.content.trim();
    } else if (section.title) {
      result.customSections.push({
        title: section.title,
        content: section.content,
      });
    }
  }

  return result;
}

// ─── Serializers ─────────────────────────────────────────────────────────────

/**
 * Serialize ParsedProfile back to PROFILE.md content.
 */
export function serializeProfile(data: ParsedProfile): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('summary: "Agent 身份与用户资料"');
  lines.push("read_when:");
  lines.push("  - 手动引导工作区");
  lines.push("---");
  lines.push("");

  lines.push("## 身份");
  lines.push("");
  lines.push(`- **名字：** ${data.agent.name || "*（挑个你喜欢的）*"}`);
  lines.push(
    `- **定位：** ${data.agent.role || "*（AI？机器人？使魔？机器里的幽灵？还是更怪的？）*"}`,
  );
  lines.push(
    `- **风格：** ${data.agent.style || "*（你给人什么感觉？犀利？温暖？混乱？冷静？）*"}`,
  );
  lines.push(`- **其他：** ${data.agent.other || "*（用户设置的其他内容）*"}`);
  lines.push("");
  lines.push("## 用户资料");
  lines.push("");
  lines.push("*了解你在帮的人。边走边更新。*");
  lines.push("");
  lines.push(`- **名字：** ${data.user.name}`);
  lines.push(`- **怎么叫他们：** ${data.user.addressAs}`);
  lines.push(`- **代词：** *（可选）* ${data.user.pronouns}`.trimEnd());
  lines.push(`- **笔记：** ${data.user.notes}`);
  lines.push("");
  lines.push("### 背景");
  lines.push("");
  if (data.user.background) {
    lines.push(data.user.background);
  } else {
    lines.push("*（他们在意什么？在做啥项目？什么让他们烦？什么逗他们笑？边走边积累。）*");
  }
  lines.push("");

  for (const custom of data.customSections) {
    lines.push(`## ${custom.title}`);
    lines.push("");
    lines.push(custom.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Serialize ParsedSoul back to SOUL.md content.
 */
export function serializeSoul(data: ParsedSoul): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('summary: "SOUL.md 工作区模板"');
  lines.push("read_when:");
  lines.push("  - 手动引导工作区");
  lines.push("---");
  lines.push("");

  if (data.intro) {
    lines.push(data.intro);
    lines.push("");
  }

  if (data.corePrinciples.length > 0) {
    lines.push("## 核心准则");
    lines.push("");
    for (const principle of data.corePrinciples) {
      lines.push(`**${principle}**`);
      lines.push("");
    }
  }

  if (data.boundaries.length > 0) {
    lines.push("## 边界");
    lines.push("");
    for (const boundary of data.boundaries) {
      lines.push(`- ${boundary}`);
    }
    lines.push("");
  }

  if (data.style) {
    lines.push("## 风格");
    lines.push("");
    lines.push(data.style);
    lines.push("");
  }

  if (data.continuity) {
    lines.push("## 连续性");
    lines.push("");
    lines.push(data.continuity);
    lines.push("");
  }

  for (const custom of data.customSections) {
    lines.push(`## ${custom.title}`);
    lines.push("");
    lines.push(custom.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Serialize ParsedAgents back to AGENTS.md content.
 */
export function serializeAgents(data: ParsedAgents): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push('summary: "AGENTS.md 工作区模板"');
  lines.push("read_when:");
  lines.push("  - 手动引导工作区");
  lines.push("---");
  lines.push("");

  if (data.safety.length > 0) {
    lines.push("## 安全");
    lines.push("");
    for (const rule of data.safety) {
      lines.push(`- ${rule}`);
    }
    lines.push("");
  }

  if (data.internalActions.length > 0 || data.externalActions.length > 0) {
    lines.push("## 内部 vs 外部");
    lines.push("");
    if (data.internalActions.length > 0) {
      lines.push("**可以自由做的：**");
      lines.push("");
      for (const action of data.internalActions) {
        lines.push(`- ${action}`);
      }
      lines.push("");
    }
    if (data.externalActions.length > 0) {
      lines.push("**先问一声：**");
      lines.push("");
      for (const action of data.externalActions) {
        lines.push(`- ${action}`);
      }
      lines.push("");
    }
  }

  if (data.emojiSection) {
    lines.push("### 😊 像人类一样用表情回应！");
    lines.push("");
    lines.push(data.emojiSection);
    lines.push("");
  }

  if (data.toolGuidelines) {
    lines.push("## 工具");
    lines.push("");
    lines.push(data.toolGuidelines);
    lines.push("");
  }

  if (data.heartbeatEnabled) {
    lines.push("<!-- heartbeat:start -->");
    lines.push("## 💓 Heartbeats - 要主动！");
    lines.push("");
    lines.push(
      "收到 heartbeat 轮询（匹配配置的 heartbeat 提示的消息）时，要给出有意义的回复。把 heartbeat 用起来！",
    );
    lines.push("");
    lines.push("默认 heartbeat 提示：");
    lines.push(
      "`有 HEARTBEAT.md 就读（工作区上下文）。严格遵循。别推测或重复之前聊天的旧任务。`",
    );
    lines.push("");
    if (data.heartbeatInterval) {
      lines.push(`心跳间隔：${data.heartbeatInterval} 分钟`);
      lines.push("");
    }
    lines.push("<!-- heartbeat:end -->");
    lines.push("");
  }

  for (const custom of data.customSections) {
    lines.push(`## ${custom.title}`);
    lines.push("");
    lines.push(custom.content);
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Convenience: parse all three files at once ──────────────────────────────

export function parsePersona(files: {
  profile?: string;
  soul?: string;
  agents?: string;
}): ParsedPersona {
  return {
    profile: files.profile ? parseProfile(files.profile) : {
      agent: { name: "", role: "", style: "", other: "" },
      user: { name: "", addressAs: "", pronouns: "", notes: "", background: "" },
      customSections: [],
    },
    soul: files.soul ? parseSoul(files.soul) : {
      intro: "",
      corePrinciples: [],
      boundaries: [],
      style: "",
      continuity: "",
      customSections: [],
    },
    agents: files.agents ? parseAgents(files.agents) : {
      safety: [],
      internalActions: [],
      externalActions: [],
      toolGuidelines: "",
      heartbeatEnabled: false,
      heartbeatInterval: "",
      emojiSection: "",
      customSections: [],
    },
  };
}

/**
 * Check if parsed persona has any unparsable custom sections.
 * Used to show a warning banner in the visual editor.
 */
export function hasUnparsedSections(persona: ParsedPersona): boolean {
  return (
    persona.profile.customSections.length > 0 ||
    persona.soul.customSections.length > 0 ||
    persona.agents.customSections.length > 0
  );
}
