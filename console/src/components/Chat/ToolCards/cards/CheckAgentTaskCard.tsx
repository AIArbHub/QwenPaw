import React from "react";
import { useTranslation } from "react-i18next";
import { SyncOutlined } from "@ant-design/icons";
import type { ToolCallContent } from "../shared/types";
import { ToolCardShell, DefaultBlock, MemberBubble } from "../shared";
import { stringifyResult } from "../shared/utils";
import { useAgentStore } from "../../../../stores/agentStore";
import { resolveAgentDisplayName } from "../../../../utils/hostAgent";

export interface CheckAgentTaskCardProps {
  content: ToolCallContent;
  isStreaming?: boolean;
}

const CheckAgentTaskCard: React.FC<CheckAgentTaskCardProps> = ({
  content,
  isStreaming,
}) => {
  const { t } = useTranslation();
  const { agents } = useAgentStore();
  const params = content.params || {};
  const agent = (params.agent_id || params.to_agent || "") as string;
  const memberName = agent ? resolveAgentDisplayName(agent, agents) : "";
  const taskId = (params.task_id || "") as string;

  let title: string;
  if (agent && taskId) {
    title = t("tool.checkAgentTask", { agent: memberName, taskId });
  } else if (agent) {
    title = t("tool.checkAgentTaskAgent", { agent: memberName });
  } else {
    title = t("tool.checkAgentTaskDefault");
  }

  const resultText = stringifyResult(content.result);

  return (
    <ToolCardShell
      content={content}
      isStreaming={isStreaming}
      icon={<SyncOutlined />}
      title={title}
      summaryAction={agent ? <MemberBubble name={memberName} /> : undefined}
    >
      {resultText && <DefaultBlock title="Output" content={resultText} />}
    </ToolCardShell>
  );
};

export default CheckAgentTaskCard;
