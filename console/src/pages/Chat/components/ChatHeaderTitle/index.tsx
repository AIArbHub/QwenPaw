import React, { useEffect, useRef, useState } from "react";
import { Dropdown } from "antd";
import { useChatAnywhereSessionsState } from "@agentscope-ai/chat";
import { Check } from "lucide-react";
import { useCodingMode } from "../../../../stores/codingModeStore";
import { useAgentStore } from "../../../../stores/agentStore";
import {
  agentAvatarColor,
  agentInitial,
  isHostAgent,
  parseHostMeta,
} from "../../../../utils/hostAgent";
import { useSidebarModeStore } from "../../../../stores/sidebarModeStore";
import { getApiUrl } from "../../../../api/config";
import styles from "./index.module.less";

const MOBILE_BREAKPOINT_PX = 480;

const ChatHeaderTitle: React.FC = () => {
  const { sessions, currentSessionId, setCurrentSessionId } =
    useChatAnywhereSessionsState();
  const { codingMode } = useCodingMode();
  const { selectedAgent, agents } = useAgentStore();
  const { mode: sidebarMode } = useSidebarModeStore();
  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const chatName = currentSession?.name || "New Chat";

  // When the current agent is a 群聊主持人, show its member avatar stack.
  const currentAgent = agents.find((a) => a.id === selectedAgent);
  const isHost = currentAgent ? isHostAgent(currentAgent) : false;
  const hostMeta =
    currentAgent && isHost ? parseHostMeta(currentAgent) : null;

  // Resolve agent avatar URL (for non-host agents in design mode).
  const agentAvatarSrc = (() => {
    if (!currentAgent || isHost) return "";
    const avatar = currentAgent.avatar;
    if (!avatar) return "";
    if (/^https?:\/\//.test(avatar)) return avatar;
    const path = avatar.replace(/^\/api/, "");
    return getApiUrl(path);
  })();

  // In design mode, show the current agent name + avatar next to the
  // session title so the user always knows which agent they are chatting
  // with.  In full / simple mode the sidebar already provides this context.
  const showAgentBadge = sidebarMode === "design" && currentAgent;
  const agentBadge = showAgentBadge ? (
    <span className={styles.agentBadge}>
      {agentAvatarSrc ? (
        <img
          src={agentAvatarSrc}
          alt={currentAgent!.name}
          className={styles.agentBadgeAvatar}
        />
      ) : (
        <span
          className={styles.agentBadgeFallback}
          style={{
            backgroundColor: agentAvatarColor(currentAgent!.name),
          }}
        >
          {agentInitial(currentAgent!.name)}
        </span>
      )}
      <span className={styles.agentBadgeName}>{currentAgent!.name}</span>
    </span>
  ) : null;

  const memberStack = hostMeta ? (
    <span className={styles.hostHeaderStack}>
      {hostMeta.members.slice(0, 4).map((m) => (
        <span
          key={m.id}
          className={styles.hostHeaderAvatar}
          style={{ backgroundColor: agentAvatarColor(m.name) }}
          title={m.name}
        >
          {agentInitial(m.name)}
        </span>
      ))}
      {hostMeta.members.length > 4 && (
        <span className={styles.hostHeaderAvatarMore}>
          +{hostMeta.members.length - 4}
        </span>
      )}
    </span>
  ) : null;

  const [open, setOpen] = useState(false);

  // Detect mobile + whether title overflows. On mobile + overflow, render as
  // a horizontal marquee; otherwise keep the original ellipsis behavior.
  const containerRef = useRef<HTMLSpanElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [shouldMarquee, setShouldMarquee] = useState(false);

  useEffect(() => {
    const check = () => {
      const w =
        typeof window !== "undefined" ? window.innerWidth : Number.MAX_VALUE;
      const isMobile = w <= MOBILE_BREAKPOINT_PX;
      if (!isMobile) {
        setShouldMarquee(false);
        return;
      }
      const containerWidth =
        containerRef.current?.getBoundingClientRect().width ?? 0;
      const textWidth = measureRef.current?.getBoundingClientRect().width ?? 0;
      // Add a few px tolerance to avoid borderline jitter.
      setShouldMarquee(textWidth > containerWidth + 2);
    };

    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [chatName, codingMode]);

  const handleSessionClick = (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setOpen(false);
  };

  const menuItems = sessions.map((session) => ({
    key: session.id,
    label: (
      <div className={styles.menuItem}>
        <span className={styles.menuItemName}>
          {session.name || "New Chat"}
        </span>
        {session.id === currentSessionId && (
          <Check className={styles.menuItemActive} size={16} aria-hidden />
        )}
      </div>
    ),
    onClick: () => handleSessionClick(session.id),
  }));

  const className = codingMode
    ? `${styles.chatName} ${styles.chatNameCoding}`
    : styles.chatName;

  const titleContent = (
    <span className={className} ref={containerRef}>
      {shouldMarquee ? (
        <span className={styles.marquee}>{chatName}</span>
      ) : (
        chatName
      )}
    </span>
  );

  const titleWrap = (
    <span className={styles.titleWrap}>
      {agentBadge}
      {memberStack ? (
        <span className={styles.hostHeaderWrap}>
          {memberStack}
          {titleContent}
        </span>
      ) : (
        titleContent
      )}
    </span>
  );

  // Hidden span used to measure intrinsic text width for the marquee decision.
  // Placed outside .chatName so it does not duplicate text for screen readers
  // or testing-library queries.
  const measureSpan = (
    <span
      ref={measureRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        visibility: "hidden",
        whiteSpace: "nowrap",
        pointerEvents: "none",
      }}
    >
      {chatName}
    </span>
  );

  if (sessions.length <= 1) {
    return (
      <>
        {titleWrap}
        {measureSpan}
      </>
    );
  }

  return (
    <Dropdown
      menu={{ items: menuItems }}
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="bottomLeft"
      overlayClassName={styles.sessionDropdown}
    >
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {titleWrap}
        {measureSpan}
      </button>
    </Dropdown>
  );
};

export default ChatHeaderTitle;
