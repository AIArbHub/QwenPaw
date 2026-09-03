import {
  AgentScopeRuntimeMessageType,
  AgentScopeRuntimeRunStatus,
  type IAgentScopeRuntimeMessage,
} from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types";

export type ResponseMessageDisplayMode = "text-only" | "result-only";

export function getResponseMessageDisplayMode(
  responseStatus: AgentScopeRuntimeRunStatus,
): ResponseMessageDisplayMode {
  if (
    responseStatus === AgentScopeRuntimeRunStatus.Created ||
    responseStatus === AgentScopeRuntimeRunStatus.InProgress
  ) {
    return "text-only";
  }
  return "result-only";
}

function isAlwaysVisible(message: IAgentScopeRuntimeMessage): boolean {
  return (
    message.type === AgentScopeRuntimeMessageType.MCP_APPROVAL_REQUEST ||
    message.type === AgentScopeRuntimeMessageType.ERROR
  );
}

/**
 * Tools that carry a group-chat member's actual speech (the host calls
 * these to let each member agent speak in turn). Their replies must be
 * rendered as visible, independent bubbles — never hidden inside the
 * collapsed "steps" accordion — so the group chat reads like a real chat.
 */
const MEMBER_REPLY_TOOLS = new Set(["chat_with_agent", "check_agent_task"]);

/**
 * Detect a group-chat member's speech in two ways:
 *
 * 1. **Native runtime (M3+):** The message carries a ``meta.group_member``
 *    marker in its metadata. This is the primary, reliable detection path —
 *    the backend runtime explicitly tags member messages.
 *
 * 2. **Legacy path (pre-M3 / fallback):** The message is a TOOL_CALL whose
 *    name is ``chat_with_agent`` or ``check_agent_task``. This is the
 *    original heuristic that guessed member replies from tool names.
 */
export function isMemberReplyMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
  // Native runtime: check meta.group_member marker (primary path)
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  if (meta && typeof meta.group_member === "string" && meta.group_member) {
    return true;
  }

  // Legacy: tool-name heuristic (fallback for old sessions / autonomous mode)
  if (message.type !== AgentScopeRuntimeMessageType.TOOL_CALL) return false;
  const anyMessage = message as unknown as {
    content?: Array<{ data?: { name?: string } }>;
    toolName?: string;
  };
  const callItem = anyMessage?.content?.[0];
  const toolName =
    (callItem?.data?.name as string | undefined) || anyMessage?.toolName || "";
  return MEMBER_REPLY_TOOLS.has(toolName);
}

/**
 * Check if a member reply message was produced by a human (human_override).
 */
export function isHumanOverrideMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  return Boolean(meta?.human_override);
}

/**
 * Check if a member reply is awaiting human input (human_pending).
 */
export function isHumanPendingMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  return Boolean(meta?.human_pending);
}

/**
 * Check if a member reply timed out waiting for human input.
 */
export function isHumanPendingTimeoutMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  return Boolean(meta?.human_pending_timeout);
}

/**
 * Check if a member reply is awaiting human approval (approval_pending).
 */
export function isApprovalPendingMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  return Boolean(meta?.approval_pending);
}

/**
 * Extract the member agent ID from a member reply message.
 *
 * For native runtime messages, this comes from ``meta.group_member``.
 * For legacy tool-call messages, this comes from the tool call arguments
 * (``to_agent`` parameter).
 */
export function getMemberAgentId(
  message: IAgentScopeRuntimeMessage,
): string | null {
  // Native runtime path
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  if (meta && typeof meta.group_member === "string" && meta.group_member) {
    return meta.group_member;
  }

  // Legacy: parse from tool call arguments
  if (message.type !== AgentScopeRuntimeMessageType.TOOL_CALL) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const legacyMsg = message as any;
  const callItem = legacyMsg?.content?.[0];
  const rawArgs = callItem?.data?.arguments;
  if (!rawArgs) return null;

  let params: Record<string, unknown> = {};
  if (typeof rawArgs === "string") {
    try {
      params = JSON.parse(rawArgs);
    } catch {
      return null;
    }
  } else if (rawArgs && typeof rawArgs === "object") {
    params = rawArgs as Record<string, unknown>;
  }

  const toAgent = params.to_agent;
  return typeof toAgent === "string" ? toAgent : null;
}

/**
 * Extract the member display name from a member reply message.
 *
 * For native runtime messages, this comes from ``meta.group_member_name``.
 * Returns ``null`` if not available (caller should fall back to agent ID).
 */
export function getMemberName(
  message: IAgentScopeRuntimeMessage,
): string | null {
  const meta = (message as unknown as { metadata?: Record<string, unknown> })
    .metadata;
  if (meta && typeof meta.group_member_name === "string") {
    return meta.group_member_name;
  }
  return null;
}

/**
 * Extract the reply text from a member reply message.
 *
 * For native runtime messages (MESSAGE type), the text is in the content
 * blocks directly. For legacy tool-call messages, the text is extracted
 * from the tool result via ``extractMemberReply``.
 */
export function getMemberReplyText(
  message: IAgentScopeRuntimeMessage,
): string | null {
  // Native runtime: message content is text blocks
  if (message.type === AgentScopeRuntimeMessageType.MESSAGE) {
    const content = message.content;
    if (!Array.isArray(content)) return null;
    const textParts: string[] = [];
    for (const item of content) {
      const text = (item as { text?: string }).text;
      if (text) textParts.push(text);
    }
    return textParts.length > 0 ? textParts.join("\n") : null;
  }

  // Legacy: will be handled by the caller via extractMemberReply
  return null;
}

export type ResponseMessageBlock =
  | { kind: "message"; message: IAgentScopeRuntimeMessage }
  | { kind: "steps"; messages: IAgentScopeRuntimeMessage[] };

export interface CollapsedStepPresentation {
  status: "finished" | "interrupted" | "generating" | "error";
  titleKey: string;
  defaultOpen: boolean;
}

export function getCollapsedStepRenderKey(
  firstId: string | number,
  mode: ResponseMessageDisplayMode,
  status: CollapsedStepPresentation["status"],
): string {
  return `steps-${firstId}-${mode}-${status}`;
}

export function getCollapsedStepPresentation(
  status: AgentScopeRuntimeRunStatus,
): CollapsedStepPresentation {
  if (
    status === AgentScopeRuntimeRunStatus.Created ||
    status === AgentScopeRuntimeRunStatus.InProgress
  ) {
    return {
      status: "generating",
      titleKey: "chat.messageDisplay.stepsRunning",
      defaultOpen: true,
    };
  }
  if (status === AgentScopeRuntimeRunStatus.Failed) {
    return {
      status: "error",
      titleKey: "chat.messageDisplay.stepsFailed",
      defaultOpen: false,
    };
  }
  if (
    status === AgentScopeRuntimeRunStatus.Canceled ||
    status === AgentScopeRuntimeRunStatus.Rejected
  ) {
    return {
      status: "interrupted",
      titleKey: "chat.messageDisplay.stepsCanceled",
      defaultOpen: false,
    };
  }
  return {
    status: "finished",
    titleKey: "chat.messageDisplay.stepsCompleted",
    defaultOpen: false,
  };
}

export function getCollapsedGroupStatus(
  responseStatus: AgentScopeRuntimeRunStatus,
  isActiveGroup: boolean,
): AgentScopeRuntimeRunStatus {
  if (!isActiveGroup) return AgentScopeRuntimeRunStatus.Completed;
  if (responseStatus === AgentScopeRuntimeRunStatus.Created) {
    return AgentScopeRuntimeRunStatus.InProgress;
  }
  return responseStatus;
}

/** Find the latest step group that has no following assistant text. */
export function findActiveStepBlockIndex(
  blocks: ResponseMessageBlock[],
): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block.kind === "steps") return index;
    if (block.message.type === AgentScopeRuntimeMessageType.MESSAGE) return -1;
  }
  return -1;
}

export function findLastStepBlockIndex(blocks: ResponseMessageBlock[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index].kind === "steps") return index;
  }
  return -1;
}

export function countCollapsedSteps(
  messages: IAgentScopeRuntimeMessage[],
): number {
  return messages.filter(
    (message) => message.type !== AgentScopeRuntimeMessageType.MESSAGE,
  ).length;
}

/** Group collapsed runs in their original position between visible messages. */
export function groupResponseMessages(
  messages: IAgentScopeRuntimeMessage[],
  mode: ResponseMessageDisplayMode,
): ResponseMessageBlock[] {
  let lastMessageIndex = -1;
  if (mode === "result-only") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].type === AgentScopeRuntimeMessageType.MESSAGE) {
        lastMessageIndex = index;
        break;
      }
    }
  }

  const blocks: ResponseMessageBlock[] = [];
  let collapsedRun: IAgentScopeRuntimeMessage[] = [];
  const flushCollapsedRun = () => {
    if (!collapsedRun.length) return;
    blocks.push({ kind: "steps", messages: collapsedRun });
    collapsedRun = [];
  };

  messages.forEach((message, index) => {
    if (message.type === AgentScopeRuntimeMessageType.HEARTBEAT) return;
    // Group-chat member replies are always shown as their own bubble so the
    // discussion reads like a real chat, even after the run completes.
    // This covers both native runtime (MESSAGE with meta.group_member) and
    // legacy (TOOL_CALL with chat_with_agent) detection paths.
    const memberReply = isMemberReplyMessage(message);
    const visible =
      isAlwaysVisible(message) ||
      memberReply ||
      (mode === "text-only" &&
        message.type === AgentScopeRuntimeMessageType.MESSAGE) ||
      (mode === "result-only" && index === lastMessageIndex);

    if (visible) {
      flushCollapsedRun();
      blocks.push({ kind: "message", message });
    } else {
      collapsedRun.push(message);
    }
  });
  flushCollapsedRun();
  return blocks;
}
