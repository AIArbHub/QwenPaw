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
import React, { useDeferredValue, useMemo } from "react";
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
  groupResponseMessages,
  isMemberReplyMessage,
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
 * MemberReplyRow — renders a group-chat member's speech as its own,
 * fully independent chat bubble (avatar on the left + distinct bubble body),
 * detached from the host agent's bubble. Group replies arrive as tool calls
 * inside the host's single response; drawing them as a real Bubble is what
 * makes the conversation read like an actual group chat instead of one big
 * host message.
 */
function MemberReplyRow({
  message,
}: {
  message: IAgentScopeRuntimeMessage;
}) {
  const { agents } = useAgentStore();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentArray = (message.content as unknown as any[]) ?? [];
  const callData = (contentArray[0]?.data ?? {}) as Record<string, unknown>;
  const resultData = (contentArray[1]?.data ?? {}) as Record<string, unknown>;

  // Only render completed replies; no result content yet = still calling.
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
          // Group-chat member replies render as their own independent bubble
          // instead of being merged into the host agent's card.
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
