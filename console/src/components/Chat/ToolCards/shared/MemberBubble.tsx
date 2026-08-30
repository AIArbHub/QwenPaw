import React from "react";
import { agentAvatarColor, agentInitial } from "../../../../utils/hostAgent";
import styles from "./toolCards.module.less";

export interface MemberBubbleProps {
  name: string;
}

const MemberBubble: React.FC<MemberBubbleProps> = ({ name }) => (
  <span className={styles.memberBubble}>
    <span
      className={styles.memberBubbleAvatar}
      style={{ backgroundColor: agentAvatarColor(name) }}
    >
      {agentInitial(name)}
    </span>
    <span className={styles.memberBubbleName}>{name}</span>
  </span>
);

export default MemberBubble;
