import React from "react";
import { useTranslation } from "react-i18next";
import { SyncOutlined } from "@ant-design/icons";
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

export interface CheckAgentTaskCardProps {
  content: ToolCallContent;
  isStreaming?: boolean;
}

/** Parse the target agent id out of a `[SESSION: <from>:to:<to>:...]` line. */
function sessionTargetAgentId(resultText: string): string {
  const m = /\[SESSION:\s*([^\]]+)\]/i.exec(resultText);
  if (!m) return "";
  const segments = m[1].trim().split(":");
  const toIdx = segments.indexOf("to");
  if (toIdx >= 0 && toIdx + 1 < segments.length) {
    return segments[toIdx + 1].trim();
  }
  return "";
}

const CheckAgentTaskCard: React.FC<CheckAgentTaskCardProps> = ({
  content,
  isStreaming,
}) => {
  const { t } = useTranslation();
  const { agents } = useAgentStore();
  const params = content.params || {};
  const resultText = stringifyResult(content.result);

  const agentId =
    (params.agent_id as string) ||
    (params.to_agent as string) ||
    sessionTargetAgentId(resultText);
  const memberName = agentId
    ? resolveAgentDisplayName(agentId, agents)
    : "";
  const taskId = (params.task_id || "") as string;

  let title: string;
  if (agentId && taskId) {
    title = t("tool.checkAgentTask", { agent: memberName, taskId });
  } else if (agentId) {
    title = t("tool.checkAgentTaskAgent", { agent: memberName });
  } else {
    title = t("tool.checkAgentTaskDefault");
  }

  const isDone = content.status === "done";
  const memberReply = isDone ? extractMemberReply(resultText) : "";

  // Completed member speech: render it as its own chat bubble, with a
  // compact trace line for the polling tool call below.
  if (isDone && memberReply) {
    return (
      <div className={styles.toolCallContainer}>
        <MemberReplyBubble name={memberName} replyText={resultText} />
        <details className={styles.memberReplyToolLine}>
          <summary>
            <SyncOutlined />
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
      icon={<SyncOutlined />}
      title={title}
      summaryAction={agentId ? <MemberBubble name={memberName} /> : undefined}
    >
      {resultText && <DefaultBlock title="Output" content={resultText} />}
    </ToolCardShell>
  );
};

export default CheckAgentTaskCard;
