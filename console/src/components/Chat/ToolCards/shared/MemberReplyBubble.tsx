/**
 * MemberReplyBubble — a member's speech rendered as its own chat bubble.
 *
 * Group-chat member replies arrive as tool results inside the host's
 * response. Rendering them as plain nested tool cards makes every speaker
 * look like part of the host bubble. This component draws each member's
 * reply as a full-width, self-contained speech bubble (avatar + name +
 * bubble body) so the conversation reads like a real group chat.
 */

import React from "react";
import { Markdown } from "@agentscope-ai/chat";
import { agentAvatarColor, agentInitial } from "../../../../utils/hostAgent";
import { extractMemberReply } from "./utils";
import styles from "./toolCards.module.less";

export interface MemberReplyBubbleProps {
  /** Member display name (e.g. 申请人 / 仲裁员). */
  name: string;
  /** Raw tool result text containing the member's reply. */
  replyText: string;
}

const MemberReplyBubble: React.FC<MemberReplyBubbleProps> = ({
  name,
  replyText,
}) => {
  const cleaned = extractMemberReply(replyText);
  if (!cleaned) return null;

  const color = agentAvatarColor(name);

  return (
    <div className={styles.memberReplyBubble}>
      <div className={styles.memberReplyHeader}>
        <span
          className={styles.memberReplyAvatar}
          style={{ backgroundColor: color }}
        >
          {agentInitial(name)}
        </span>
        <span className={styles.memberReplyName}>{name}</span>
      </div>
      <div className={styles.memberReplyBody}>
        <Markdown content={cleaned} />
      </div>
    </div>
  );
};

export default React.memo(MemberReplyBubble);
