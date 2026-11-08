/**
 * pages/Chat/HostBubbles.tsx — host-side response renderer for CoPaw-specific
 * Markdown, media download, artifact, and plugin behavior.
 *
 * Why wrappers:
 * - We register HostResponseCard into options.cards so the SDK Cards
 *   dispatcher invokes it instead of the vendor default.
 * - The wrapper itself subscribes to the chat extension registry via hooks,
 *   so it re-renders when plugins register/dispose — no need to rebuild the
 *   parent useMemo (and avoid re-mounting bubbles on every plugin change).
 *
 * SDK 1.2 integrations use the public request.render/prepend/append seam.
 * HostRequestCard retains the original vendor-card wrapper for callers that
 * register it directly; do not also configure the same public request slots.
 * Vendor response primitives remain private dependencies because CoPaw
 * replaces individual Markdown/media/tool rendering rather than only framing
 * the default response bubble.
 */
import React, { useCallback, useMemo, useSyncExternalStore } from "react";
import VendorRequestCard from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Request/Card";
import AgentScopeRuntimeResponseBuilder from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Builder";
import ResponseActions from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Actions";
import ResponseError from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Error";
import ResponseReasoning from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Reasoning";
import ResponseTool from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Tool";
import {
  AgentScopeRuntimeContentType,
  AgentScopeRuntimeMessageType,
  AgentScopeRuntimeRunStatus,
  Bubble,
  DefaultCards,
  Markdown,
  type IAgentScopeRuntimeMessage,
  type IAgentScopeRuntimeResponse,
} from "@agentscope-ai/chat";
import { useChatAnywhereOptions } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Context/ChatAnywhereOptionsContext";
import { Avatar, Flex } from "antd";
import { useTranslation } from "react-i18next";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { useEffectiveFontSize } from "@/contexts/FontSizeContext";
import {
  useChatScalarSnapshot,
  useChatListSnapshot,
} from "../../plugins/registry/useChatExtensions";
import { ChatScalar, ChatList } from "../../plugins/registry/slotKeys";
import { PluginSlotBoundary } from "../../plugins/registry/PluginSlotBoundary";
import type {
  ChatRequestData,
  ChatResponseData,
} from "../../plugins/registry/types";
import { DownloadableAudios } from "../../components/Chat/MediaDownload";
import { ToolCallTurnBoundary } from "./turnEndedProvider";
import ResponseArtifactList from "../../features/files-workspace/ResponseArtifactList";
import { isToolLikeResponseMessageType } from "./responseMessageTypes";
import {
  countCollapsedSteps,
  filterThinkingMessages,
  findActiveStepBlockIndex,
  findLastStepBlockIndex,
  getCollapsedGroupStatus,
  getCollapsedStepPresentation,
  getCollapsedStepRenderKey,
  getResponseMessageDisplayMode,
  groupResponseMessages,
  isMemberReplyMessage,
  isHumanOverrideMessage,
  isHumanPendingMessage,
  isHumanPendingTimeoutMessage,
  getMemberAgentId,
  getMemberName,
  getMemberReplyText,
} from "./messageDisplay";
import styles from "./HostBubbles.module.less";
import LazyAccordion from "./LazyAccordion";
import { useAgentStore } from "../../stores/agentStore";
import {
  agentAvatarColor,
  agentInitial,
  resolveAgentDisplayName,
} from "../../utils/hostAgent";
import {
  extractMemberReply,
  stringifyResult,
} from "../../components/Chat/ToolCards/shared/utils";
import { groupChatsApi } from "../../api/modules/groupChats";
import { useChatScope } from "./sessionScope";
import {
  getAssistantMessageDisplayPreference,
  getShowThinkingPreference,
  subscribeChatDisplayPreference,
  type AssistantMessageDisplayPreference,
} from "../../utils/chatDisplayPreference";

function sortByOrder<T extends { item: { order?: number } }>(arr: T[]): T[] {
  return arr
    .slice()
    .sort((a, b) => (a.item.order ?? 100) - (b.item.order ?? 100));
}

const HostMessage = React.memo(function HostMessage({
  data,
}: {
  data: IAgentScopeRuntimeMessage;
}) {
  const replaceMediaURL = useChatAnywhereOptions(
    (options) => options.api?.replaceMediaURL,
  );
  const onFileCardClick = useChatAnywhereOptions(
    (options) => options.api?.onFileCardClick,
  );
  const formatMediaURL = (url?: string) =>
    url ? replaceMediaURL?.(url) || url : url;
  const baseFontSize = useEffectiveFontSize();

  if (!data.content?.length) return null;

  return (
    <>
      {data.content.map((item, index) => {
        switch (item.type) {
          case AgentScopeRuntimeContentType.TEXT:
            return (
              <AssistantMarkdown
                key={index}
                messageId={`${data.id}:${index}`}
                content={item.text}
                cursor={item.status === AgentScopeRuntimeRunStatus.InProgress}
                // Native text deltas omit content.status; the message owns
                // their lifecycle. Keep the legacy Markdown cursor separate.
                isStreaming={
                  (item.status ?? data.status) ===
                  AgentScopeRuntimeRunStatus.InProgress
                }
              />
            );
          case AgentScopeRuntimeContentType.REFUSAL:
            return (
              <Markdown
                key={index}
                content={item.refusal}
                raw
                baseFontSize={baseFontSize}
              />
            );
          case AgentScopeRuntimeContentType.IMAGE:
            return (
              <DefaultCards.Images
                key={index}
                data={[{ url: formatMediaURL(item.image_url) }]}
              />
            );
          case AgentScopeRuntimeContentType.VIDEO:
            return (
              <DefaultCards.Videos
                key={index}
                data={[
                  {
                    poster: formatMediaURL(item.video_poster),
                    src: formatMediaURL(item.video_url) || "",
                  },
                ]}
              />
            );
          case AgentScopeRuntimeContentType.FILE:
            return (
              <DefaultCards.Files
                key={index}
                data={[
                  {
                    name: item.file_name || item.fileName || item.file_id,
                    size: item.file_size,
                    url: formatMediaURL(item.file_url),
                  },
                ]}
                onClick={onFileCardClick}
              />
            );
          case AgentScopeRuntimeContentType.AUDIO:
            return (
              <DownloadableAudios
                key={index}
                data={[
                  { src: formatMediaURL(item.audio_url || item.data) || "" },
                ]}
              />
            );
          default:
            return <div key={index}>{JSON.stringify(item)}</div>;
        }
      })}
    </>
  );
});

/**
 * MemberReplyRow — 将群聊成员的发言渲染为独立的聊天气泡
 * （左侧头像 + 独立气泡体），与宿主 agent 的气泡分离。
 *
 * 支持两种消息格式：
 * - **原生运行时 (M3+)**：MESSAGE 类型，携带 ``meta.group_member`` 标记。
 *   文本直接在 content 块中。
 * - **遗留格式**：TOOL_CALL 类型，包含 ``chat_with_agent``/``check_agent_task``。
 *   文本通过 ``extractMemberReply`` 从工具结果中提取。
 *
 * M6 流式传输：当消息状态为 ``InProgress`` 时，气泡显示
 * 闪烁光标以表示成员仍在生成中。
 */
function MemberReplyRow({
  message,
}: {
  message: IAgentScopeRuntimeMessage;
}) {
  const { agents, selectedAgent: storeSelectedAgent } = useAgentStore();
  const { t } = useTranslation();
  const scope = useChatScope();
  const hostAgentId = scope?.agentId ?? storeSelectedAgent ?? "";
  const sessionId =
    scope?.currentSessionId ??
    (window as unknown as { currentSessionId?: string }).currentSessionId ??
    "";

  // ── 原生运行时路径：MESSAGE 类型，携带 meta.group_member 标记 ──
  const nativeReplyText = getMemberReplyText(message);
  const nativeAgentId = getMemberAgentId(message);
  const nativeName = getMemberName(message);

  // M6: 检查成员是否仍在生成中（流式传输进行中）
  const isStreaming =
    message.status === AgentScopeRuntimeRunStatus.InProgress ||
    message.status === AgentScopeRuntimeRunStatus.Created;

  const hasText = nativeReplyText != null && nativeReplyText.length > 0;

  // M1 HITL: 从消息元数据中提取人工控制状态
  const isHumanPending = isHumanPendingMessage(message);
  const isHumanTimeout = isHumanPendingTimeoutMessage(message);
  const isHumanOverride = isHumanOverrideMessage(message);

  // 仅当有足够的上下文调用 API 时才显示 HITL 操作按钮
  const canShowHITLButtons = Boolean(
    hostAgentId && sessionId && nativeAgentId,
  );

  const handleTakeover = useCallback(async () => {
    if (!nativeAgentId) return;
    try {
      await groupChatsApi.setController({
        host_agent_id: hostAgentId,
        session_id: sessionId,
        member_id: nativeAgentId,
        controller: "human",
      });
    } catch (e) {
      console.warn("[MemberReplyRow] takeover failed", e);
    }
  }, [hostAgentId, sessionId, nativeAgentId]);

  const handleInterrupt = useCallback(async () => {
    if (!nativeAgentId) return;
    try {
      await groupChatsApi.interruptMember({
        host_agent_id: hostAgentId,
        session_id: sessionId,
        member_id: nativeAgentId,
      });
    } catch (e) {
      console.warn("[MemberReplyRow] interrupt failed", e);
    }
  }, [hostAgentId, sessionId, nativeAgentId]);

  const handleEdit = useCallback(async () => {
    if (!nativeAgentId || !nativeReplyText) return;
    const edited = window.prompt(
      t("chat.groupChat.editPrompt", "编辑发言内容："),
      nativeReplyText,
    );
    if (edited === null || edited.trim() === nativeReplyText.trim()) return;
    try {
      await groupChatsApi.editTurn({
        host_agent_id: hostAgentId,
        session_id: sessionId,
        turn_id: nativeAgentId,
        text: edited,
      });
    } catch (e) {
      console.warn("[MemberReplyRow] edit failed", e);
    }
  }, [hostAgentId, sessionId, nativeAgentId, nativeReplyText, t]);

  // M6: 如果正在流式传输且暂无文本，显示带成员头像和名字的打字指示器。
  // M1 HITL: 如果处于人工等待状态，显示“等待您发言”提示。
  if (nativeAgentId && isStreaming && !hasText) {
    const name =
      nativeName ||
      resolveAgentDisplayName(nativeAgentId, agents) ||
      nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span
        className={styles.memberReplyAvatar}
        style={{ backgroundColor: color }}
      >
        {agentInitial(name)}
      </span>
    );
    if (isHumanPending) {
      return (
        <div className={styles.memberReplyRow}>
          <div className={styles.memberReplyName}>
            {name}
            <span className={styles.humanPendingHint}>
              {t("chat.groupChat.waitingForHuman", "等待您发言…")}
            </span>
          </div>
          <Bubble avatar={avatarNode} className={styles.memberReplyBubble}>
            <span className={styles.awaitingHint}>
              {t("chat.groupChat.awaitingInput", "等待人工输入")}
            </span>
          </Bubble>
        </div>
      );
    }
    if (isHumanTimeout) {
      return (
        <div className={styles.memberReplyRow}>
          <div className={styles.memberReplyName}>
            {name}
            <span className={styles.humanTimeoutHint}>
              {t("chat.groupChat.humanTimeout", "（等待超时）")}
            </span>
          </div>
          <Bubble
            avatar={avatarNode}
            className={styles.memberReplyBubble}
            content={t(
              "chat.groupChat.humanTimeoutMsg",
              "该角色本轮未发言（等待人工超时）",
            )}
            {...({ variant: "filled" } as object)}
          />
        </div>
      );
    }
    return (
      <div className={styles.memberReplyRow}>
        <div className={styles.memberReplyName}>
          {name}
          {canShowHITLButtons && (
            <span className={styles.hitlButtons}>
              <button
                type="button"
                className={styles.hitlBtn}
                onClick={handleTakeover}
                title={t("chat.groupChat.takeover", "接管")}
              >
                {t("chat.groupChat.takeover", "接管")}
              </button>
              <button
                type="button"
                className={styles.hitlBtn}
                onClick={handleInterrupt}
                title={t("chat.groupChat.interrupt", "打断")}
              >
                {t("chat.groupChat.interrupt", "打断")}
              </button>
            </span>
          )}
        </div>
        <Bubble avatar={avatarNode} className={styles.memberReplyBubble}>
          <Bubble.Spin />
        </Bubble>
      </div>
    );
  }

  if (hasText && nativeAgentId) {
    const name =
      nativeName ||
      resolveAgentDisplayName(nativeAgentId, agents) ||
      nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span
        className={styles.memberReplyAvatar}
        style={{ backgroundColor: color }}
      >
        {agentInitial(name)}
      </span>
    );
    return (
      <div className={styles.memberReplyRow}>
        <div className={styles.memberReplyName}>
          {name}
          {isHumanOverride && (
            <span className={styles.humanBadge}>
              {t("chat.groupChat.humanBadge", "人类")}
            </span>
          )}
          {canShowHITLButtons && !isStreaming && (
            <span className={styles.hitlButtons}>
              <button
                type="button"
                className={styles.hitlBtn}
                onClick={handleTakeover}
                title={t("chat.groupChat.takeover", "接管")}
              >
                {t("chat.groupChat.takeover", "接管")}
              </button>
              <button
                type="button"
                className={styles.hitlBtn}
                onClick={handleEdit}
                title={t("chat.groupChat.edit", "编辑")}
              >
                {t("chat.groupChat.edit", "编辑")}
              </button>
            </span>
          )}
        </div>
        <Bubble
          avatar={avatarNode}
          className={styles.memberReplyBubble}
          content={nativeReplyText}
          {...({
            msgStatus: isStreaming ? "generating" : "finished",
          } as object)}
          {...({ variant: "filled" } as object)}
        />
      </div>
    );
  }

  // 原生路径：有 agent ID 但流式传输结束且无文本 → 显示错误占位符
  if (nativeAgentId && !isStreaming && !hasText) {
    const name =
      nativeName ||
      resolveAgentDisplayName(nativeAgentId, agents) ||
      nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span
        className={styles.memberReplyAvatar}
        style={{ backgroundColor: color }}
      >
        {agentInitial(name)}
      </span>
    );
    return (
      <div className={styles.memberReplyRow}>
        <div className={styles.memberReplyName}>{name}</div>
        <Bubble
          avatar={avatarNode}
          className={styles.memberReplyBubble}
          content="(No response)"
          {...({ variant: "filled" } as object)}
        />
      </div>
    );
  }

  // ── 遗留路径：TOOL_CALL 类型，包含 chat_with_agent/check_agent_task ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentArray = (message.content as unknown as any[]) ?? [];
  const callData = (contentArray[0]?.data ?? {}) as Record<string, unknown>;
  const resultData = (contentArray[1]?.data ?? {}) as Record<string, unknown>;

  const result = resultData.output;
  if (result == null) return null;

  let params: Record<string, unknown> = {};
  const rawArgs = callData.arguments;
  if (typeof rawArgs === "string") {
    try {
      params = JSON.parse(rawArgs);
    } catch {
      params = {};
    }
  } else if (rawArgs && typeof rawArgs === "object") {
    params = rawArgs as Record<string, unknown>;
  }

  const agentId = (params.to_agent as string) || "";
  if (!agentId) return null;
  const name = resolveAgentDisplayName(agentId, agents) || agentId;

  const replyText = extractMemberReply(stringifyResult(result));
  if (!replyText) return null;

  const color = agentAvatarColor(name);
  const avatarNode = (
    <span
      className={styles.memberReplyAvatar}
      style={{ backgroundColor: color }}
    >
      {agentInitial(name)}
    </span>
  );

  return (
    <div className={styles.memberReplyRow}>
      <div className={styles.memberReplyName}>{name}</div>
      <Bubble
        avatar={avatarNode}
        className={styles.memberReplyBubble}
        content={replyText}
        {...({ variant: "filled" } as object)}
      />
    </div>
  );
}

function renderResponseMessage(item: IAgentScopeRuntimeMessage) {
  if (isToolLikeResponseMessageType(item.type)) {
    return <ResponseTool key={item.id} data={item} />;
  }
  switch (item.type) {
    case AgentScopeRuntimeMessageType.MESSAGE:
      return <HostMessage key={item.id} data={item} />;
    case AgentScopeRuntimeMessageType.MCP_APPROVAL_REQUEST:
      return <ResponseTool key={item.id} data={item} isApproval />;
    case AgentScopeRuntimeMessageType.REASONING:
      return <ResponseReasoning key={item.id} data={item} />;
    case AgentScopeRuntimeMessageType.ERROR:
      return <ResponseError key={item.id} data={item} />;
    case AgentScopeRuntimeMessageType.HEARTBEAT:
      return null;
    default:
      console.warn(`[WIP] Unknown message type: ${item.type}`);
      return null;
  }
}

function DefaultHostResponseCard({
  data,
  messageId,
  isLast,
  contentPrepend,
  contentAppend,
}: {
  data: IAgentScopeRuntimeResponse;
  messageId: string;
  isLast?: boolean;
  contentPrepend?: React.ReactNode;
  contentAppend?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const avatar = useChatAnywhereOptions((options) => options.welcome?.avatar);
  const nick = useChatAnywhereOptions((options) => options.welcome?.nick);
  const nickNode =
    typeof nick === "string" || React.isValidElement(nick) ? nick : null;
  const mergedMessages = useMemo(
    () => AgentScopeRuntimeResponseBuilder.mergeToolMessages(data.output),
    [data.output],
  );
  const showThinking = useSyncExternalStore(
    subscribeChatDisplayPreference,
    getShowThinkingPreference,
    () => true,
  );
  const messages = useMemo(
    () => filterThinkingMessages(mergedMessages, showThinking),
    [mergedMessages, showThinking],
  );
  const assistantDisplayPreference =
    useSyncExternalStore<AssistantMessageDisplayPreference>(
      subscribeChatDisplayPreference,
      getAssistantMessageDisplayPreference,
      () => "result-collapsed",
    );
  const messageDisplayMode = getResponseMessageDisplayMode(
    data.status,
    assistantDisplayPreference,
  );
  const messageBlocks = useMemo(
    () => groupResponseMessages(messages, messageDisplayMode),
    [messageDisplayMode, messages],
  );
  const activeStepBlockIndex = findActiveStepBlockIndex(messageBlocks);
  const statusStepBlockIndex =
    messageDisplayMode === "text-only"
      ? activeStepBlockIndex
      : findLastStepBlockIndex(messageBlocks);

  if (
    !messages.length &&
    AgentScopeRuntimeResponseBuilder.maybeGenerating(data)
  ) {
    return <Bubble.Spin />;
  }

  return (
    <>
      {avatar ? (
        <Flex align="center" gap={8} style={{ marginBottom: 8 }}>
          <Avatar src={avatar} />
          {nickNode ? <span>{nickNode}</span> : null}
        </Flex>
      ) : null}
      {contentPrepend}
      {messageBlocks.map((block, index) => {
        if (block.kind === "message") {
          if (isMemberReplyMessage(block.message)) {
            return (
              <MemberReplyRow
                key={block.message.id}
                message={block.message}
              />
            );
          }
          return renderResponseMessage(block.message);
        }

        const groupStatus = getCollapsedGroupStatus(
          data.status,
          index === statusStepBlockIndex,
        );
        const presentation = getCollapsedStepPresentation(groupStatus);
        const firstId = block.messages[0]?.id ?? index;
        const stepCount = countCollapsedSteps(block.messages);
        if (stepCount === 0) {
          return (
            <React.Fragment key={`messages-${firstId}`}>
              {block.messages.map(renderResponseMessage)}
            </React.Fragment>
          );
        }
        return (
          <LazyAccordion
            className={styles.collapsedSteps}
            key={getCollapsedStepRenderKey(
              firstId,
              messageDisplayMode,
              presentation.status,
            )}
            status={presentation.status}
            title={t(presentation.titleKey, {
              count: stepCount,
            })}
            defaultOpen={presentation.defaultOpen}
            renderChildren={() => (
              <>{block.messages.map(renderResponseMessage)}</>
            )}
          />
        );
      })}
      {data.error ? <ResponseError data={data.error} /> : null}
      {!messages.length && data.status === "canceled" ? (
        <Bubble.Interrupted title={t("chat.turnCanceled")} />
      ) : null}
      {contentAppend}
      {AgentScopeRuntimeResponseBuilder.maybeDone(data) ? (
        <ResponseArtifactList messages={messages} />
      ) : null}
      <ResponseActions data={data} messageId={messageId} isLast={isLast} />
    </>
  );
}

function HostRequestCardContent(props: { data: ChatRequestData }) {
  const extScalar = useChatScalarSnapshot();
  const extLists = useChatListSnapshot();

  const renderEntry = extScalar[ChatScalar.requestRender];
  const renderFn = renderEntry?.value;
  const prependList = sortByOrder(extLists[ChatList.requestPrepend]);
  const appendList = sortByOrder(extLists[ChatList.requestAppend]);

  // prepend/append routed through vendor's contentPrepend/contentAppend
  // slot so actions stay last. Mirrors HostResponseCard.
  const contentPrepend =
    prependList.length === 0 ? null : (
      <>
        {prependList.map((e) => (
          <PluginSlotBoundary
            key={e.item.id}
            slot={ChatList.requestPrepend}
            pluginId={e.pluginId}
          >
            {e.item.render({ data: props.data })}
          </PluginSlotBoundary>
        ))}
      </>
    );
  const contentAppend =
    appendList.length === 0 ? null : (
      <>
        {appendList.map((e) => (
          <PluginSlotBoundary
            key={e.item.id}
            slot={ChatList.requestAppend}
            pluginId={e.pluginId}
          >
            {e.item.render({ data: props.data })}
          </PluginSlotBoundary>
        ))}
      </>
    );

  const fallback = () => (
    <VendorRequestCard
      data={
        props.data as unknown as React.ComponentProps<
          typeof VendorRequestCard
        >["data"]
      }
      contentPrepend={contentPrepend}
      contentAppend={contentAppend}
    />
  );

  if (renderFn) {
    return (
      <PluginSlotBoundary
        slot={ChatScalar.requestRender}
        pluginId={renderEntry!.pluginId}
        fallback={fallback()}
      >
        {renderFn({ data: props.data, fallback })}
      </PluginSlotBoundary>
    );
  }
  return fallback();
}

const MemoizedHostRequestCard = React.memo(HostRequestCardContent);

export function HostRequestCard(props: { data: ChatRequestData }) {
  return <MemoizedHostRequestCard {...props} />;
}

function HostResponseCardContent(props: {
  id: string;
  data: ChatResponseData;
  isLast?: boolean;
}) {
  const extScalar = useChatScalarSnapshot();
  const extLists = useChatListSnapshot();

  const renderEntry = extScalar[ChatScalar.responseRender];
  const renderFn = renderEntry?.value;
  const prependList = sortByOrder(extLists[ChatList.responsePrepend]);
  const appendList = sortByOrder(extLists[ChatList.responseAppend]);

  // prepend/append are routed through vendor's contentPrepend/contentAppend
  // slot so they land BETWEEN messages and Actions — actions always last.
  // Vendor change: see Response/Card.js DefaultResponseRender, which now
  // reads props.contentPrepend / props.contentAppend.
  const contentPrepend =
    prependList.length === 0 ? null : (
      <>
        {prependList.map((e) => (
          <PluginSlotBoundary
            key={e.item.id}
            slot={ChatList.responsePrepend}
            pluginId={e.pluginId}
          >
            {e.item.render({ data: props.data, isLast: props.isLast })}
          </PluginSlotBoundary>
        ))}
      </>
    );
  const contentAppend =
    appendList.length === 0 ? null : (
      <>
        {appendList.map((e) => (
          <PluginSlotBoundary
            key={e.item.id}
            slot={ChatList.responseAppend}
            pluginId={e.pluginId}
          >
            {e.item.render({ data: props.data, isLast: props.isLast })}
          </PluginSlotBoundary>
        ))}
      </>
    );

  const fallback = () => (
    <DefaultHostResponseCard
      data={props.data as unknown as IAgentScopeRuntimeResponse}
      messageId={props.id}
      isLast={props.isLast}
      contentPrepend={contentPrepend}
      contentAppend={contentAppend}
    />
  );

  if (renderFn) {
    return (
      <PluginSlotBoundary
        slot={ChatScalar.responseRender}
        pluginId={renderEntry!.pluginId}
        fallback={fallback()}
      >
        {renderFn({
          data: props.data,
          isLast: props.isLast,
          fallback,
        })}
      </PluginSlotBoundary>
    );
  }
  return fallback();
}

const MemoizedHostResponseCard = React.memo(HostResponseCardContent);

export function HostResponseCard(props: {
  id: string;
  data: ChatResponseData;
  isLast?: boolean;
}) {
  // Tool cards cannot tell a running call from one whose turn was interrupted
  // because both lack a result message. Wrapping the whole card publishes the
  // turn state without re-rendering its body: the memoized content bails out
  // on unchanged props.
  return (
    <ToolCallTurnBoundary
      data={props.data as unknown as IAgentScopeRuntimeResponse}
    >
      <MemoizedHostResponseCard {...props} />
    </ToolCallTurnBoundary>
  );
}
