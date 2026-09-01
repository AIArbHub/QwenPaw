import React from "react";
import { useTranslation } from "react-i18next";
import { MessageOutlined } from "@ant-design/icons";
import type { ToolCallContent } from "../shared/types";
import {
  ToolCardShell,
  DefaultBlock,
  MemberBubble,
  MemberReplyBubble,
  extractMemberReply,
} from "../shared";
import { stringifyResult } from "../shared/utils";
import { useAgentStore } from "../../../../stores/agentStore";
import { resolveAgentDisplayName } from "../../../../utils/hostAgent";
import styles from "../shared/toolCards.module.less";

export interface ChatWithAgentCardProps {
  content: ToolCallContent;
  isStreaming?: boolean;
}

const ChatWithAgentCard: React.FC<ChatWithAgentCardProps> = ({
  content,
  isStreaming,
}) => {
  const { t } = useTranslation();
  const { agents } = useAgentStore();
  const params = content.params || {};
  const agentId = (params.to_agent || "") as string;
  const memberName = agentId
    ? resolveAgentDisplayName(agentId, agents)
    : "";
  const title = agentId
    ? t("tool.chatWithAgent", { agent: memberName })
    : t("tool.chatWithAgentDefault");

  const resultText = stringifyResult(content.result);
  const isDone = content.status === "done";
  const memberReply = isDone ? extractMemberReply(resultText) : "";

  // Completed member speech: render it as its own chat bubble (avatar +
  // name + bubble body), with a compact trace line for the tool call below.
  if (isDone && memberReply) {
    return (
      <div className={styles.toolCallContainer}>
        <MemberReplyBubble name={memberName} replyText={resultText} />
        <details className={styles.memberReplyToolLine}>
          <summary>
            <MessageOutlined />
            <span>{title}</span>
          </summary>
        </details>
      </div>
    );
  }

  return (
    <ToolCardShell
      content={content}
      isStreaming={isStreaming}
      icon={<MessageOutlined />}
      title={title}
      summaryAction={agentId ? <MemberBubble name={memberName} /> : undefined}
    >
      {resultText && <DefaultBlock title="Output" content={resultText} />}
    </ToolCardShell>
  );
};

export default ChatWithAgentCard;
