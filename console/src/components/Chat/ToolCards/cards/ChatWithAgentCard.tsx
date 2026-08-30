import React from "react";
import { useTranslation } from "react-i18next";
import { MessageOutlined } from "@ant-design/icons";
import type { ToolCallContent } from "../shared/types";
import { ToolCardShell, DefaultBlock, MemberBubble } from "../shared";
import { stringifyResult } from "../shared/utils";
import { useAgentStore } from "../../../../stores/agentStore";
import { resolveAgentDisplayName } from "../../../../utils/hostAgent";

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
