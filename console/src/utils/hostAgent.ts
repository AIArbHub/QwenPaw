// -*- coding: utf-8 -*-
/**
 * Host-Agent (群聊主持人) helpers.
 *
 * Convention:
 *  - Host agent id always starts with the "host_" prefix.
 *  - Host agent description ends with a structured metadata comment
 *    so UIs (agent list, chat header, bubbles) can recover member list
 *    and mode without extra network calls or file reads.
 *  - The orchestration instructions live in AGENTS.md inside the host
 *    workspace (loaded automatically via PromptBuilder).
 */

import type { AgentSummary } from "../api/types/agents";

export type HostScheduleMode = "round_robin" | "parallel" | "autonomous";

export interface HostMember {
  id: string;
  name: string;
}

export interface HostMetaPayload {
  members: HostMember[];
  mode: HostScheduleMode;
  /** ISO timestamp when host was created */
  created_at?: string;
  /** Display version for future schema bumps */
  v?: number;
}

const HOST_ID_PREFIX = "host_";
const HOST_META_RE = /<!--\s*HOST:\s*(\{.*?\})\s*-->/s;

export const HOST_MODE_LABEL: Record<HostScheduleMode, string> = {
  round_robin: "串行圆桌",
  parallel: "并行独立",
  autonomous: "主持人自主",
};

export const HOST_MODE_DESC: Record<HostScheduleMode, string> = {
  round_robin:
    "按成员顺序依次发言，每一位成员都可以参考前面成员的意见，最后主持人形成结论。适合需要层层递进、逐步打磨的议题。",
  parallel:
    "同时向所有成员发送相同议题，成员之间独立思考互不干扰，收齐后主持人综合各方独立观点。适合需要多视角、避免从众效应的议题。",
  autonomous:
    "由主持人根据讨论进程自由决定让谁发言、追问什么、是否并行或串行。最灵活的模式，适合复杂开放、难以预设流程的议题。（实验性：使用 LLM 自主调度，原生运行时不支持此模式）",
};

/** Returns true when the agent summary refers to a host agent. */
export function isHostAgent(agent: Pick<AgentSummary, "id" | "description">): boolean {
  if (agent.id.startsWith(HOST_ID_PREFIX)) return true;
  if (typeof agent.description === "string") {
    return HOST_META_RE.test(agent.description);
  }
  return false;
}

/** Parse the HOST comment block out of a description. */
export function parseHostMeta(
  agent: Pick<AgentSummary, "description">,
): HostMetaPayload | null {
  const desc = agent.description || "";
  const m = desc.match(HOST_META_RE);
  if (!m) return null;
  try {
    const data = JSON.parse(m[1]) as HostMetaPayload;
    if (!Array.isArray(data.members)) return null;
    if (!data.mode) return null;
    return data;
  } catch {
    return null;
  }
}

/** Return the human-facing portion of a host description (strip comment). */
export function stripHostMeta(description: string | undefined): string {
  if (!description) return "";
  return description.replace(HOST_META_RE, "").trim();
}

/** Build the structured comment that encodes host metadata into description. */
function encodeHostMeta(meta: HostMetaPayload): string {
  return `<!-- HOST:${JSON.stringify({ v: 1, ...meta })} -->`;
}

/** Build the final description text (visible description + encoded meta). */
export function buildHostDescription(
  userDescription: string,
  meta: HostMetaPayload,
): string {
  const head = userDescription.trim();
  const tail = encodeHostMeta(meta);
  return head ? `${head}\n\n${tail}` : tail;
}

/** Build an id for a new host agent. */
export function generateHostId(): string {
  const random = Math.random().toString(36).slice(2, 8);
  const ts = Math.floor(Date.now() / 1000).toString(36);
  return `${HOST_ID_PREFIX}${ts}${random}`;
}

// ── AGENTS.md templates (one per schedule mode) ──────────────────────────
//
// These templates tell the host agent "who you are", "who the members are",
// and "what discussion protocol to follow". They intentionally use plain
// Chinese suitable for C端 users (法学背景人员) — no technical jargon.

function memberRosterBlock(members: HostMember[], mode: HostScheduleMode): string {
  const rows = members
    .map((m) => `- ${m.name}（智能体 ID: ${m.id}）`)
    .join("\n");
  const toolNote =
    mode === "autonomous"
      ? "你需要使用上述 ID 通过 `chat_with_agent` 工具与成员对话。"
      : "运行时会自动将议题派发给每位成员，你无需手动调用任何工具。";
  return `## 成员名单\n\n${rows}\n\n讨论中务必使用成员的真实姓名/头衔来称呼，不要直接显示 ID。\n${toolNote}\n`;
}

function runtimeInfoBlock(mode: HostScheduleMode): string {
  if (mode === "autonomous") {
    // Autonomous mode is not supported by the native runtime, so it
    // falls back to _process where the host must use tools.
    return [
      "## 运行机制",
      "",
      "- 本群聊使用「主持人自主」模式，由你主动调度成员发言。",
      "- 你需要使用 `chat_with_agent(to_agent=ID, text=发言内容)` 工具来与成员对话。",
      "- 你可以根据讨论情况自由决定让谁发言、追问什么、是否并行或串行。",
      "- 当你认为信息足够时，请输出最终结论。",
      "",
    ].join("\n");
  }
  // round_robin and parallel are supported by the native runtime
  const modeSpecific =
    mode === "parallel"
      ? "所有成员将同时收到相同的议题，各自独立思考，互不影响。所有成员回答完毕后，你会收到汇总并进行综合。"
      : "成员将按顺序依次发言。每位成员都可以参考前面成员的观点。所有成员发言完毕后，你将进行总结。";
  return [
    "## 运行机制（原生群聊运行时）",
    "",
    "- 本群聊由原生运行时编排，成员的发言和调度由系统自动完成。",
    `- ${modeSpecific}`,
    "- 你的主要职责是：理解用户议题、形成讨论引导、最终综合成员观点并输出结论。",
    "- 你**无需**调用 `chat_with_agent` 或 `submit_to_agent` 等工具——运行时会自动将议题派发给成员。",
    "- 如果你判断需要追加追问或开启新一轮讨论，直接在回复中说明即可，运行时会识别你的意图。",
    "",
  ].join("\n");
}

function protocolBlock(mode: HostScheduleMode, members: HostMember[]): string {
  if (mode === "round_robin") {
    const order = members.map((m) => m.name).join(" → ");
    return [
      "## 讨论流程（串行圆桌）",
      "",
      `发言顺序：${order}`,
      "",
      "1. 运行时会先将用户议题交给你，你需将其拆解为清晰的讨论引导。",
      "2. 成员按上述顺序依次发言，后发言的成员会收到前面成员的观点摘要。",
      "3. 所有成员发言完毕后，运行时将所有观点交给你进行综合。",
      "4. 你需要形成一份条理清晰的结论，并明确标注每位成员的核心观点。",
      "5. 如果用户后续继续追问新的问题，按同样流程再次讨论。",
      "",
    ].join("\n");
  }
  if (mode === "parallel") {
    return [
      "## 讨论流程（并行独立）",
      "",
      "1. 运行时会将你拆解后的议题同时发给所有成员，成员之间互不知晓彼此存在。",
      "2. 所有成员独立提交后，运行时将结果汇总给你。",
      "3. 你需把每个人的独立回答并列展示，然后综合各方观点，提炼共识点和分歧点。",
      "4. 给出一份不带偏向的综合结论。",
      "5. 若需要第二轮，可以把第一轮的观点汇总再次发给成员（这一轮就不是独立了，可注明是讨论稿）。",
      "",
    ].join("\n");
  }
  return [
    "## 讨论流程（主持人自主）",
    "",
    "你作为主持人拥有完全的调度自由，请根据议题灵活决定：",
    "",
    "- 使用 `chat_with_agent` 工具与成员对话，根据讨论情况自由选择先请哪位成员发言；",
    "- 对含混的回答进行追问，要求给出更具体的论证；",
    "- 出现分歧时邀请各方进一步辩论，必要时请某成员就另一位的具体观点直接回应；",
    "- 如果成员回答已经非常充分，可直接收束；如果明显不够，继续提问。",
    "- 在认为讨论足够时，给出最终总结，包括：共识、分歧、主持人建议。",
    "",
  ].join("\n");
}

function closingBlock(groupName: string): string {
  return [
    "## 输出风格",
    "",
    "- 你的最终回复应使用面向 C 端用户的通俗中文（默认简体中文），避免使用技术黑话。",
    "- 当引用成员的发言时，使用清晰的小标题（如「[张三（法律顾问） 观点]」）并引用其核心论据。",
    "- 每次讨论结束后，给出一段「📋 本次讨论纪要」章节，包含：",
    "  - 本次讨论的议题",
    "  - 各成员观点摘要（列表）",
    "  - 共识与分歧",
    "  - 主持人的最终建议或结论",
    "",
    `## 身份定位`,
    "",
    `- 你是「${groupName}」的主持人（不是普通的个人助手）。`,
    `- 用户的每一条消息都是一次「发起议题 / 继续讨论」，而不是对你个人的提问。`,
    `- 你必须通过与成员讨论来回答，不能只凭自己的想法直接给结论。哪怕你认为自己知道答案，也要至少邀请 1-2 位成员先发言，以保证讨论过程的完整性。`,
    `- 如果用户希望单独和某成员对话，请告诉他们切换到该成员的单聊窗口即可。`,
    "",
  ].join("\n");
}

export function buildHostAGENTSMD(
  groupName: string,
  members: HostMember[],
  mode: HostScheduleMode,
): string {
  return [
    `# 群聊：${groupName} — 主持人 AGENTS.md`,
    "",
    `本文件由「创建群聊」向导自动生成。`,
    `讨论模式：**${HOST_MODE_LABEL[mode]}**`,
    "",
    memberRosterBlock(members, mode),
    runtimeInfoBlock(mode),
    protocolBlock(mode, members),
    closingBlock(groupName),
    "---",
    "",
    "> 提示：如果用户在对话中修改了成员，你需要提醒其通过「编辑群聊」功能来刷新本文件，以确保成员名单和协议一致。",
    "",
  ].join("\n");
}

// ── PROFILE.md template ──────────────────────────────────────────────────

export function buildHostPROFILEMD(
  groupName: string,
  userDescription: string,
  members: HostMember[],
  mode: HostScheduleMode,
): string {
  const modeLabel = HOST_MODE_LABEL[mode];
  const memberSummary = members.map((m) => `- ${m.name}`).join("\n");
  const about = userDescription.trim() || `${groupName} 讨论会。`;

  return [
    `# ${groupName} — 群聊主持人`,
    "",
    "## 身份",
    "",
    `我是 **${groupName}** 的专职主持人，负责按照「${modeLabel}」流程组织成员围绕议题展开讨论，并整理讨论纪要。`,
    `我不会只凭自己的知识直接给出答案，而是通过原生群聊运行时自动调度成员智能体发言，综合各方观点后给出最终结论。`,
    "",
    "## 职责",
    "",
    "- 正确理解用户的议题，并拆成成员可以直接讨论的问题。",
    "- 按照既定讨论流程调度成员发言。",
    "- 在回复中清晰呈现每位成员的观点，而不是混为一谈。",
    "- 讨论结束时输出「📋 本次讨论纪要」章节。",
    "",
    "## 成员",
    "",
    memberSummary,
    "",
    "## 关于",
    "",
    about,
    "",
  ].join("\n");
}

// ── Shared UI helpers (avatar color / initials / name resolution) ─────────

const AGENT_AVATAR_PALETTE = [
  "#0065fd",
  "#13c2c2",
  "#eb2f96",
  "#fa8c16",
  "#52c41a",
  "#722ed1",
  "#faad14",
  "#2f54eb",
  "#a0d911",
  "#f5222d",
];

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) % 1000003;
  }
  return hash;
}

/** Stable per-name avatar background color. */
export function agentAvatarColor(name: string): string {
  const text = name || "";
  return AGENT_AVATAR_PALETTE[hashString(text) % AGENT_AVATAR_PALETTE.length];
}

/** First letter of a name for avatar fallback. */
export function agentInitial(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

/** Resolve an agent id to its display name, falling back to the raw id. */
export function resolveAgentDisplayName(
  agentId: string,
  agents: AgentSummary[],
): string {
  const found = agents.find((a) => a.id === agentId);
  return found ? found.name : agentId;
}
