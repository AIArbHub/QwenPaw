/**
 * pages/Chat/HostBubbles.tsx — host-side wrappers around the vendor's
 * AgentScopeRuntime{Request,Response}Card components.
 *
 * Why wrappers:
 * - Plugin extensions (chat.request.render / prepend / append and the
 *   response equivalents) need a render seam SDK doesn't expose.
 * - We register HostRequestCard / HostResponseCard into options.cards so the
 *   SDK Cards dispatcher invokes them instead of the vendor defaults.
 * - The wrapper itself subscribes to the chat extension registry via hooks,
 *   so it re-renders when plugins register/dispose — no need to rebuild the
 *   parent useMemo (and avoid re-mounting bubbles on every plugin change).
 *
 * Vendor response primitives are deep-imported because the SDK does not expose
 * a message-renderer seam. If their paths change, update the imports below.
 */
import React, { useCallback, useDeferredValue, useMemo } from "react";
import VendorRequestCardOriginal from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Request/Card";
import AgentScopeRuntimeResponseBuilder from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Builder";
import ResponseActions from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Actions";
import ResponseError from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Error";
import ResponseReasoning from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Reasoning";
import ResponseTool from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Tool";
import {
  AgentScopeRuntimeContentType,
  AgentScopeRuntimeMessageType,
  AgentScopeRuntimeRunStatus,
  type IAgentScopeRuntimeMessage,
  type IAgentScopeRuntimeResponse,
} from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types";
import { useChatAnywhereOptions } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Context/ChatAnywhereOptionsContext";
import Images from "@agentscope-ai/chat/lib/DefaultCards/Images";
import Videos from "@agentscope-ai/chat/lib/DefaultCards/Videos";
import Files from "@agentscope-ai/chat/lib/DefaultCards/Files";
import { Bubble, Markdown } from "@agentscope-ai/chat";
import { Avatar, Flex } from "antd";
import { useTranslation } from "react-i18next";
import { renderableCodeComponents } from "../../components/RenderableCodeBlock";
// Vendor `.d.ts` doesn't yet describe the request content slots.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const VendorRequestCard = VendorRequestCardOriginal as React.ComponentType<any>;
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
import ResponseArtifactList from "../../features/files-workspace/ResponseArtifactList";
import {
  countCollapsedSteps,
  findActiveStepBlockIndex,
  findLastStepBlockIndex,
  getCollapsedGroupStatus,
  getCollapsedStepPresentation,
  getCollapsedStepRenderKey,
  getResponseMessageDisplayMode,
  getMemberAgentId,
  getMemberName,
  getMemberReplyText,
  groupResponseMessages,
  isMemberReplyMessage,
  isHumanOverrideMessage,
  isHumanPendingMessage,
  isHumanPendingTimeoutMessage,
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

function sortByOrder<T extends { item: { order?: number } }>(arr: T[]): T[] {
  return arr
    .slice()
    .sort((a, b) => (a.item.order ?? 100) - (b.item.order ?? 100));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCardProps = any;

function DeferredMarkdown({
  content,
  cursor,
}: {
  content: string;
  cursor: boolean;
}) {
  // Parsing Markdown, code fences, and diagrams is substantially more
  // expensive than appending stream text. A deferred value lets React skip
  // obsolete intermediate parses while keeping input and scrolling responsive.
  const deferredContent = useDeferredValue(content);

  return (
    <Markdown
      components={renderableCodeComponents}
      content={deferredContent}
      cursor={cursor}
    />
  );
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

  if (!data.content?.length) return null;

  return (
    <>
      {data.content.map((item, index) => {
        switch (item.type) {
          case AgentScopeRuntimeContentType.TEXT:
            return (
              <DeferredMarkdown
                key={index}
                content={item.text}
                cursor={item.status === AgentScopeRuntimeRunStatus.InProgress}
              />
            );
          case AgentScopeRuntimeContentType.REFUSAL:
            return <Markdown key={index} content={item.refusal} raw />;
          case AgentScopeRuntimeContentType.IMAGE:
            return (
              <Images
                key={index}
                data={[{ url: formatMediaURL(item.image_url) }]}
              />
            );
          case AgentScopeRuntimeContentType.VIDEO:
            return (
              <Videos
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
              <Files
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

function renderResponseMessage(item: IAgentScopeRuntimeMessage) {
  switch (item.type) {
    case AgentScopeRuntimeMessageType.MESSAGE:
      return <HostMessage key={item.id} data={item} />;
    case AgentScopeRuntimeMessageType.PLUGIN_CALL:
    case AgentScopeRuntimeMessageType.PLUGIN_CALL_OUTPUT:
    case AgentScopeRuntimeMessageType.TOOL_CALL:
    case AgentScopeRuntimeMessageType.TOOL_CALL_OUTPUT:
    case AgentScopeRuntimeMessageType.MCP_CALL:
    case AgentScopeRuntimeMessageType.MCP_CALL_OUTPUT:
      return <ResponseTool key={item.id} data={item} />;
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
  const sessionId = scope?.currentSessionId ?? (window as unknown as { currentSessionId?: string }).currentSessionId ?? "";

  // ── 原生运行时路径：MESSAGE 类型，携带 meta.group_member 标记 ──
  const nativeReplyText = getMemberReplyText(message);
  const nativeAgentId = getMemberAgentId(message);
  const nativeName = getMemberName(message);

  // M6: 检查成员是否仍在生成中（流式传输进行中）
  const isStreaming =
    message.status === AgentScopeRuntimeRunStatus.InProgress ||
    message.status === AgentScopeRuntimeRunStatus.Created;

  // 原生路径：有 agent ID 且有文本内容或正在流式传输
  // 流式传输但文本为空时，显示打字指示器 (Bubble.Spin)
  // 而不是空白气泡。
  const hasText = nativeReplyText != null && nativeReplyText.length > 0;

  // M1 HITL: 从消息元数据中提取人工控制状态
  const isHumanPending = isHumanPendingMessage(message);
  const isHumanTimeout = isHumanPendingTimeoutMessage(message);
  const isHumanOverride = isHumanOverrideMessage(message);

  // 仅当有足够的上下文调用 API 时才显示 HITL 操作按钮
  const canShowHITLButtons = Boolean(hostAgentId && sessionId && nativeAgentId);

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

  const handleRelease = useCallback(async () => {
    if (!nativeAgentId) return;
    try {
      await groupChatsApi.setController({
        host_agent_id: hostAgentId,
        session_id: sessionId,
        member_id: nativeAgentId,
        controller: "auto",
      });
    } catch (e) {
      console.warn("[MemberReplyRow] release failed", e);
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
    const name = nativeName || resolveAgentDisplayName(nativeAgentId, agents) || nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span className={styles.memberReplyAvatar} style={{ backgroundColor: color }}>
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
            content={t("chat.groupChat.humanTimeoutMsg", "该角色本轮未发言（等待人工超时）")}
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
    const name = nativeName || resolveAgentDisplayName(nativeAgentId, agents) || nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span className={styles.memberReplyAvatar} style={{ backgroundColor: color }}>
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
          {...({ msgStatus: isStreaming ? "generating" : "finished" } as object)}
          {...({ variant: "filled" } as object)}
        />
      </div>
    );
  }

  // 原生路径：有 agent ID 但流式传输结束且无文本 → 显示错误占位符
  if (nativeAgentId && !isStreaming && !hasText) {
    const name = nativeName || resolveAgentDisplayName(nativeAgentId, agents) || nativeAgentId;
    const color = agentAvatarColor(name);
    const avatarNode = (
      <span className={styles.memberReplyAvatar} style={{ backgroundColor: color }}>
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

  // 仅渲染已完成的回复；无结果内容 = 仍在调用中。
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
    <span className={styles.memberReplyAvatar} style={{ backgroundColor: color }}>
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
        // `variant` turns on the filled bubble background at runtime, but the
        // vendor `.d.ts` does not yet describe it — cast to satisfy TS.
        {...({ variant: "filled" } as object)}
      />
    </div>
  );
}

function DefaultHostResponseCard({
  data,
  isLast,
  contentPrepend,
  contentAppend,
}: {
  data: IAgentScopeRuntimeResponse;
  isLast?: boolean;
  contentPrepend?: React.ReactNode;
  contentAppend?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const avatar = useChatAnywhereOptions((options) => options.welcome?.avatar);
  const nick = useChatAnywhereOptions((options) => options.welcome?.nick);
  const messages = useMemo(
    () => AgentScopeRuntimeResponseBuilder.mergeToolMessages(data.output),
    [data.output],
  );
  const messageDisplayMode = getResponseMessageDisplayMode(data.status);
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
          {nick ? <span>{nick}</span> : null}
        </Flex>
      ) : null}
      {contentPrepend}
      {messageBlocks.map((block, index) => {
        if (block.kind === "message") {
          // 群聊成员回复渲染为独立的气泡，
          // 而不是合并到宿主 agent 的卡片中。
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
      {contentAppend}
      {AgentScopeRuntimeResponseBuilder.maybeDone(data) ? (
        <ResponseArtifactList messages={messages} />
      ) : null}
      <ResponseActions data={data} isLast={isLast} />
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
      data={props.data as AnyCardProps}
      contentPrepend={contentPrepend as AnyCardProps}
      contentAppend={contentAppend as AnyCardProps}
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
  data: ChatResponseData;
  isLast?: boolean;
}) {
  return <MemoizedHostResponseCard {...props} />;
}
