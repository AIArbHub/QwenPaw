/**
 * Right sidebar for the Moot case detail view.
 * Contains case info, participants, timeline, and files.
 */
import {
  Button,
  Tag,
  Space,
  Dropdown,
  Popconfirm,
  Empty,
  Timeline,
} from "antd";
import type { MenuProps } from "antd";
import {
  UserAddOutlined,
  SettingOutlined,
  DeleteOutlined,
  TeamOutlined,
  FileTextOutlined,
  RobotOutlined,
  FileDoneOutlined,
  UploadOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from "@ant-design/icons";
import {
  ROLE_CATEGORY_LABELS,
  ROLE_COLORS,
  COLLABORATION_MODE_LABELS,
  type MootCaseData,
  type MootParticipant,
  type MootCaseFile,
  type MootCaseEvent,
  type CollaborationMode,
  type FileVisibility,
} from "@/api/modules/moot";
import dayjs from "dayjs";
import styles from "../index.module.less";

function formatDate(ts: number): string {
  return dayjs(ts * 1000).format("YYYY-MM-DD HH:mm");
}

interface SidebarPanelProps {
  caseData: MootCaseData;
  participants: MootParticipant[];
  caseFiles: MootCaseFile[];
  events: MootCaseEvent[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  onAddParticipant: () => void;
  onUploadFile: () => void;
  onUpdateCollabMode: (participantId: string, mode: CollaborationMode) => void;
  onRemoveParticipant: (participantId: string) => void;
  onDeleteFile: (fileId: string) => void;
  onShareFile: (fileId: string, visibility: FileVisibility) => void;
  onGenerateDocument: () => void;
  onScoreParticipant: () => void;
}

export function SidebarPanel(props: SidebarPanelProps) {
  const {
    caseData,
    participants,
    caseFiles,
    events,
    collapsed,
    onToggleCollapse,
    onAddParticipant,
    onUploadFile,
    onUpdateCollabMode,
    onRemoveParticipant,
    onDeleteFile,
    onGenerateDocument,
    onScoreParticipant,
  } = props;

  if (collapsed) {
    return (
      <Button
        className={styles.sidebarExpandBtn}
        icon={<MenuUnfoldOutlined />}
        onClick={onToggleCollapse}
      />
    );
  }

  const collabModeMenu = (pid: string): MenuProps["items"] => [
    ...(["human_lead", "ai_lead", "full_ai", "full_human"] as CollaborationMode[]).map(
      (mode) => ({
        key: mode,
        label: `${COLLABORATION_MODE_LABELS[mode]} — ${
          mode === "human_lead"
            ? "用户主导"
            : mode === "ai_lead"
              ? "AI主导"
              : mode === "full_ai"
                ? "AI自主"
                : "人工操作"
        }`,
        onClick: () => onUpdateCollabMode(pid, mode),
      }),
    ),
  ];

  const timelineItems = events
    .slice(-10)
    .reverse()
    .map((e) => ({
      color: e.event_type === "stage_change" ? "blue" : "gray",
      children: (
        <div>
          <div style={{ fontWeight: 500, fontSize: 13 }}>{e.description}</div>
          <div style={{ fontSize: 11, color: "var(--ant-color-text-quaternary)" }}>
            {formatDate(e.timestamp)}
          </div>
        </div>
      ),
    }));

  return (
    <div className={styles.sidebar}>
      <Button
        className={styles.sidebarCollapseBtn}
        size="small"
        icon={<MenuFoldOutlined />}
        onClick={onToggleCollapse}
      />

      {/* Case Info */}
      <div className={styles.sidebarSection}>
        <div className={styles.sidebarTitle}>
          <span>案件信息</span>
        </div>
        <div style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 8 }}>
          {caseData.case_description || "暂无描述"}
        </div>
        {caseData.rules.length > 0 && (
          <div className={styles.rulesSection}>
            {caseData.rules.map((r, i) => (
              <Tag key={i} color="purple" style={{ fontSize: 11 }}>
                {r}
              </Tag>
            ))}
          </div>
        )}
        <Space size={4} style={{ marginTop: 8 }} wrap>
          <Button
            size="small"
            type="primary"
            icon={<FileDoneOutlined />}
            onClick={onGenerateDocument}
          >
            生成文书
          </Button>
          <Button
            size="small"
            icon={<RobotOutlined />}
            onClick={onScoreParticipant}
          >
            评分
          </Button>
        </Space>
      </div>

      {/* Participants */}
      <div className={styles.sidebarSection}>
        <div className={styles.sidebarTitle}>
          <span>
            <TeamOutlined /> 参与者 ({participants.length})
          </span>
          <Button
            size="small"
            type="text"
            icon={<UserAddOutlined />}
            onClick={onAddParticipant}
          />
        </div>
        {participants.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无参与者"
          />
        ) : (
          participants.map((p) => (
            <div key={p.participant_id} className={styles.participantCard}>
              <div
                className={styles.participantAvatar}
                style={{ background: ROLE_COLORS[p.role] }}
              >
                {p.display_name.charAt(0)}
              </div>
              <div className={styles.participantInfo}>
                <div className={styles.participantName}>{p.display_name}</div>
                <div className={styles.participantRole}>
                  {p.role_detail || ROLE_CATEGORY_LABELS[p.role]} ·{" "}
                  {COLLABORATION_MODE_LABELS[p.collaboration_mode]}
                </div>
              </div>
              <div className={styles.participantActions}>
                <Dropdown menu={{ items: collabModeMenu(p.participant_id) }} trigger={["click"]}>
                  <Button size="small" type="text" icon={<SettingOutlined />} />
                </Dropdown>
                <Popconfirm
                  title="确认移除该参与者？"
                  onConfirm={() => onRemoveParticipant(p.participant_id)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Case Files */}
      <div className={styles.sidebarSection}>
        <div className={styles.sidebarTitle}>
          <span>
            <FileTextOutlined /> 案件文件 ({caseFiles.length})
          </span>
          <Button
            size="small"
            type="text"
            icon={<UploadOutlined />}
            onClick={onUploadFile}
          />
        </div>
        {caseFiles.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无文件"
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {caseFiles.map((f) => (
              <div
                key={f.file_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 6px",
                  borderRadius: 6,
                  background: "var(--ant-color-bg-layout)",
                  fontSize: 12,
                }}
              >
                <FileTextOutlined style={{ flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {f.filename}
                </span>
                <Tag
                  style={{
                    fontSize: 10,
                    lineHeight: "14px",
                    margin: 0,
                  }}
                  color={
                    f.visibility === "shared"
                      ? "green"
                      : f.visibility === "directed"
                        ? "orange"
                        : "default"
                  }
                >
                  {f.visibility === "shared"
                    ? "共享"
                    : f.visibility === "directed"
                      ? "指定"
                      : "私有"}
                </Tag>
                <Popconfirm
                  title="确认删除？"
                  onConfirm={() => onDeleteFile(f.file_id)}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    style={{ padding: 0 }}
                  />
                </Popconfirm>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className={styles.sidebarSection}>
        <div className={styles.sidebarTitle}>
          <span>案件时间线</span>
        </div>
        {timelineItems.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无事件"
          />
        ) : (
          <Timeline items={timelineItems} />
        )}
      </div>
    </div>
  );
}
