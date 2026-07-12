/**
 * Message panel: displays the message list and input area.
 * Includes selection mode for multi-message operations.
 */
import { useRef, useEffect } from "react";
import {
  Button,
  Input,
  Tag,
  Space,
  Tooltip,
  Popconfirm,
  Dropdown,
} from "antd";
import type { MenuProps } from "antd";
import {
  SendOutlined,
  RobotOutlined,
  DeleteOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  ShareAltOutlined,
  DownOutlined,
} from "@ant-design/icons";
import {
  ROLE_COLORS,
  type MootMessage,
  type MootParticipant,
  type CaseStage,
} from "@/api/modules/moot";
import dayjs from "dayjs";
import styles from "../index.module.less";

function getAvatarLetter(name: string): string {
  return name.charAt(0);
}

function formatTime(ts: number): string {
  return dayjs(ts * 1000).format("HH:mm:ss");
}

interface MessagePanelProps {
  messages: MootMessage[];
  participants: MootParticipant[];
  selectedParticipant: string;
  onSelectParticipant: (id: string) => void;
  inputText: string;
  onInputChange: (v: string) => void;
  onSpeak: () => Promise<void>;
  onAutoSpeak: (participantId: string) => Promise<void>;
  isClosed: boolean;
  currentStage: CaseStage;

  // Selection mode
  isSelectionMode: boolean;
  selectedMessageIds: Set<string>;
  onToggleSelection: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onEnterSelectionMode: () => void;
  onDeleteSelected: () => void;
  onShareSelected: () => void;

  // View mode
  viewMode: "director" | "role";
  currentRoleParticipantId: string;
  onSelectRoleParticipant: (id: string) => void;
}

export function MessagePanel(props: MessagePanelProps) {
  const {
    messages,
    participants,
    selectedParticipant,
    onSelectParticipant,
    inputText,
    onInputChange,
    onSpeak,
    onAutoSpeak,
    isClosed,
    currentStage,
    isSelectionMode,
    selectedMessageIds,
    onToggleSelection,
    onSelectAll,
    onClearSelection,
    onEnterSelectionMode,
    onDeleteSelected,
    onShareSelected,
    viewMode,
    currentRoleParticipantId,
    onSelectRoleParticipant,
  } = props;

  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const activePid =
    viewMode === "role" ? currentRoleParticipantId : selectedParticipant;

  const participantMenuItems: MenuProps["items"] = participants.map((p) => ({
    key: p.participant_id,
    label: (
      <Space>
        <span style={{ color: ROLE_COLORS[p.role] }}>●</span>
        {p.display_name}
        <span style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
          {p.role_detail || ROLE_CATEGORY_LABELS[p.role]}
        </span>
      </Space>
    ),
    onClick: () => {
      if (viewMode === "role") onSelectRoleParticipant(p.participant_id);
      else onSelectParticipant(p.participant_id);
    },
  }));

  return (
    <div className={styles.mainArea}>
      {/* Selection mode toolbar */}
      {isSelectionMode && selectedMessageIds.size > 0 && (
        <div className={styles.selectionBarFloat}>
          <span>已选 {selectedMessageIds.size} 条消息</span>
          <Space>
            <Button size="small" onClick={onSelectAll}>
              {selectedMessageIds.size === messages.length ? "取消全选" : "全选"}
            </Button>
            <Popconfirm
              title="确认删除选中的消息？"
              onConfirm={onDeleteSelected}
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
            <Button size="small" icon={<ShareAltOutlined />} onClick={onShareSelected}>
              分享
            </Button>
          </Space>
        </div>
      )}

      {/* Message list */}
      <div
        className={styles.messageList}
        ref={listRef}
        style={
          isSelectionMode && selectedMessageIds.size > 0
            ? { paddingTop: 50 }
            : undefined
        }
      >
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <RobotOutlined style={{ fontSize: 40, color: "var(--ant-color-text-quaternary)" }} />
            <span style={{ color: "var(--ant-color-text-quaternary)" }}>
              暂无消息，选择角色后开始对话
            </span>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelected = selectedMessageIds.has(msg.id);
            return (
              <div
                key={msg.id}
                className={styles.messageItem}
                style={
                  isSelectionMode
                    ? {
                        cursor: "pointer",
                        background: isSelected ? "#f0f5ff" : undefined,
                        borderRadius: 8,
                        padding: 8,
                      }
                    : undefined
                }
                onClick={() => {
                  if (isSelectionMode) onToggleSelection(msg.id);
                }}
              >
                <div
                  className={styles.avatar}
                  style={{ background: ROLE_COLORS[msg.role] }}
                >
                  {getAvatarLetter(msg.display_name)}
                </div>
                <div className={styles.messageContent}>
                  <div className={styles.messageMeta}>
                    <span className={styles.displayName}>{msg.display_name}</span>
                    {msg.role_detail && (
                      <Tag
                        color={ROLE_COLORS[msg.role]}
                        style={{ fontSize: 10, lineHeight: "16px" }}
                      >
                        {msg.role_detail}
                      </Tag>
                    )}
                    <span className={styles.messageTime}>
                      {formatTime(msg.timestamp)}
                    </span>
                    {isSelectionMode && isSelected && (
                      <CheckSquareOutlined style={{ color: "var(--ant-color-primary)" }} />
                    )}
                  </div>
                  <div
                    className={`${styles.messageBubble} ${
                      msg.is_system ? styles.messageBubbleSystem : ""
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      {!isClosed && (
        <div className={styles.inputArea}>
          {!isSelectionMode && (
            <div className={styles.selectionToggleFloat}>
              <Tooltip title="多选消息">
                <Button
                  size="small"
                  icon={<CheckSquareOutlined />}
                  onClick={onEnterSelectionMode}
                />
              </Tooltip>
            </div>
          )}
          {isSelectionMode && (
            <Button
              size="small"
              icon={<CloseOutlined />}
              onClick={onClearSelection}
              style={{ marginBottom: 8 }}
            >
              退出多选
            </Button>
          )}
          <div className={styles.inputRow}>
            <Dropdown menu={{ items: participantMenuItems }} trigger={["click"]}>
              <Button
                icon={
                  <span style={{ color: activePid ? undefined : "var(--ant-color-text-quaternary)" }}>
                    {activePid
                      ? participants.find((p) => p.participant_id === activePid)?.display_name || "选择角色"
                      : "选择角色"}
                  </span>
                }
                iconRender={() => null}
              >
                <Space>
                  {activePid
                    ? participants.find((p) => p.participant_id === activePid)?.display_name || "选择角色"
                    : "选择角色"}
                  <DownOutlined />
                </Space>
              </Button>
            </Dropdown>
            <Input.TextArea
              className={styles.inputText}
              value={inputText}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={`以${
                activePid
                  ? participants.find((p) => p.participant_id === activePid)?.display_name || "当前角色"
                  : "选中角色"
              }身份发言...（当前阶段：${currentStage}）`}
              autoSize={{ minRows: 1, maxRows: 4 }}
              onPressEnter={(e) => {
                if (e.shiftKey) return;
                e.preventDefault();
                onSpeak();
              }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={onSpeak}
              disabled={!inputText.trim() || !activePid}
            >
              发言
            </Button>
            {activePid && (
              <Tooltip title="AI自动发言">
                <Button
                  icon={<RobotOutlined />}
                  onClick={() => onAutoSpeak(activePid)}
                />
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
