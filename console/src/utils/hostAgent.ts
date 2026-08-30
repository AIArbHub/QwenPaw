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
    "由主持人根据讨论进程自由决定让谁发言、追问什么、是否并行或串行。最灵活的模式，适合复杂开放、难以预设流程的议题。",
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

function memberRosterBlock(members: HostMember[]): string {
  const rows = members
    .map((m) => `- 智能体ID「${m.id}」— ${m.name}`)
    .join("\n");
  return `## 成员名单（必须使用下面列出的 ID 调用 chat_with_agent 或 submit_to_agent）\n\n${rows}\n\n讨论中务必使用成员的真实姓名/头衔来称呼，不要直接显示 ID。\n`;
}

function toolReminderBlock(mode: HostScheduleMode): string {
  if (mode === "parallel") {
    return [
      "## 工具使用说明",
      "",
      "- 用 `submit_to_agent(to_agent=ID, text=发言内容, task_timeout=1800)` 同时给每位成员派题，然后再用 `check_agent_task(task_id)` 查询每位的结果。",
      "- 不要用 `chat_with_agent` 串行问，会破坏并行独立的意义。",
      "- 所有成员返回后再给出综合结论，中途不要提前总结。",
      "",
    ].join("\n");
  }
  if (mode === "round_robin") {
    return [
      "## 工具使用说明",
      "",
      "- 用 `chat_with_agent(to_agent=ID, text=发言内容, timeout=600)` 逐个提问，每位成员的问题里务必附上前一位或几位成员的观点。",
      "- 如果预计某成员需要超过 5 分钟才能答复，可以用 `submit_to_agent` + `check_agent_task` 的方式等候。",
      "- 全部成员回答完毕后再输出最终结论。",
      "",
    ].join("\n");
  }
  return [
    "## 工具使用说明",
    "",
    "- 你可以自由地选择 `chat_with_agent`（同步对话，适合追问）或 `submit_to_agent` + `check_agent_task`（后台任务，适合长时间独立思考）。",
    "- 可以根据讨论情况决定对哪位成员追问、邀请新成员发言、或者请大家分别就一个子问题独立作答。",
    "- 当你认为信息已经足够时，请输出最终结论，不要再继续开会。",
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
      "1. 把用户的原始议题拆成清晰的问题说明，作为主持人的引导。",
      "2. 先向第一位成员发问，请其就议题发表自己的独立观点。",
      "3. 从第二位成员开始，在问题里附上前面成员的原话/要点，让其在参考已有观点的基础上给出自己的判断（同意/不同意/补充/修正）。",
      "4. 所有成员依次发言后，主持人综合所有人意见，形成一份条理清晰的结论，并明确标注每位成员的核心观点。",
      "5. 如果用户后续继续追问新的问题，按同样顺序再次讨论。",
      "",
    ].join("\n");
  }
  if (mode === "parallel") {
    return [
      "## 讨论流程（并行独立）",
      "",
      "1. 把用户的原始议题改写成完全相同的一份问题说明。",
      "2. **同一轮内给每位成员发送完全相同的问题**，不要告诉他们其他成员也在回答，避免互相影响。",
      "3. 所有成员提交后，把每个人的独立回答并列展示。",
      "4. 最后主持人综合各方独立观点，提炼共识点和分歧点，给出一份不带偏向的综合结论。",
      "5. 若需要第二轮，可以把第一轮的观点汇总再次发给成员（这一轮就不是独立了，可注明是讨论稿）。",
      "",
    ].join("\n");
  }
  return [
    "## 讨论流程（主持人自主）",
    "",
    "你作为主持人拥有完全的调度自由，请根据议题灵活决定：",
    "",
    "- 第一轮先请核心成员分别表态，再视情况请其余成员补充；",
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
    memberRosterBlock(members),
    toolReminderBlock(mode),
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
    `我不会只凭自己的知识直接给出答案，而是会调用参与的成员智能体进行讨论，综合后给出最终结论。`,
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
