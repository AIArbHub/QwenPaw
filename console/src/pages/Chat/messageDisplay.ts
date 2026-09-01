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

export function isMemberReplyMessage(
  message: IAgentScopeRuntimeMessage,
): boolean {
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
