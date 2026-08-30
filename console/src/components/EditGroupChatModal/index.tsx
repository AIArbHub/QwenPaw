import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  Radio,
  Avatar,
  Checkbox,
  Empty,
  Alert,
  Space,
} from "antd";
import { Users2, ListOrdered, Layers, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { agentsApi } from "../../api/modules/agents";
import { workspaceApi } from "../../api/modules/workspace";
import { useAgentStore } from "../../stores/agentStore";
import { useAppMessage } from "../../hooks/useAppMessage";
import type { AgentSummary } from "../../api/types/agents";
import {
  agentAvatarColor,
  agentInitial,
  buildHostAGENTSMD,
  buildHostDescription,
  buildHostPROFILEMD,
  HOST_MODE_DESC,
  HOST_MODE_LABEL,
  isHostAgent,
  parseHostMeta,
  stripHostMeta,
  type HostMember,
  type HostScheduleMode,
} from "../../utils/hostAgent";
import { isAgentAvailableInChat } from "../../utils/agentVisibility";
import styles from "./index.module.less";

const { TextArea } = Input;

const MODE_LIST: {
  value: HostScheduleMode;
  label: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  {
    value: "round_robin",
    label: HOST_MODE_LABEL.round_robin,
    desc: HOST_MODE_DESC.round_robin,
    icon: <ListOrdered size={22} />,
  },
  {
    value: "parallel",
    label: HOST_MODE_LABEL.parallel,
    desc: HOST_MODE_DESC.parallel,
    icon: <Layers size={22} />,
  },
  {
    value: "autonomous",
    label: HOST_MODE_LABEL.autonomous,
    desc: HOST_MODE_DESC.autonomous,
    icon: <UserRound size={22} />,
  },
];

interface EditGroupChatModalProps {
  open: boolean;
  /** Host agent being edited; null keeps the modal inert. */
  agent: AgentSummary | null;
  onCancel: () => void;
  onSaved?: () => void;
}

const EditGroupChatModal: React.FC<EditGroupChatModalProps> = ({
  open,
  agent,
  onCancel,
  onSaved,
}) => {
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const { agents, refreshAgents } = useAgentStore();

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<HostScheduleMode>("round_robin");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Refresh agents on open so the member selector is never stale.
  useEffect(() => {
    if (open) {
      void refreshAgents();
    }
  }, [open, refreshAgents]);

  // Populate the form from the host agent's metadata whenever it opens.
  useEffect(() => {
    if (open && agent) {
      const meta = parseHostMeta(agent);
      setName(agent.name);
      setDesc(stripHostMeta(agent.description));
      setSelectedIds(meta ? meta.members.map((m) => m.id) : []);
      setMode((meta?.mode as HostScheduleMode) || "round_robin");
      setErrorText(null);
    }
  }, [open, agent]);

  const memberCandidates: AgentSummary[] = useMemo(() => {
    return agents.filter((a) => {
      if (isHostAgent(a)) return false;
      if (!isAgentAvailableInChat(a)) return false;
      return true;
    });
  }, [agents]);

  const selectedMembers: AgentSummary[] = useMemo(
    () =>
      selectedIds
        .map((id) => agents.find((a) => a.id === id))
        .filter((a): a is AgentSummary => Boolean(a)),
    [agents, selectedIds],
  );

  const toggleMember = (id: string) => (e: CheckboxChangeEvent) => {
    setSelectedIds((prev) =>
      e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? memberCandidates.map((a) => a.id) : []);
  };

  const handleCancel = () => {
    if (submitting) return;
    setErrorText(null);
    onCancel();
  };

  const handleSave = async () => {
    if (!agent) return;
    if (!name.trim()) {
      setErrorText(t("hostModal.nameRequired", "请输入群聊名称"));
      return;
    }
    if (selectedMembers.length < 2) {
      setErrorText(t("hostModal.membersRequired", "请至少选择 2 位成员"));
      return;
    }

    setErrorText(null);
    setSubmitting(true);
    try {
      const membersMeta: HostMember[] = selectedMembers.map((a) => ({
        id: a.id,
        name: a.name,
      }));
      const existingMeta = parseHostMeta(agent);
      const meta = {
        members: membersMeta,
        mode,
        ...(existingMeta?.created_at
          ? { created_at: existingMeta.created_at }
          : {}),
      };
      const finalDescription = buildHostDescription(desc.trim(), meta);

      await agentsApi.updateAgent(agent.id, {
        id: agent.id,
        name: name.trim(),
        description: finalDescription,
      });
      await workspaceApi.saveFileForAgent(
        agent.id,
        "AGENTS.md",
        buildHostAGENTSMD(name.trim(), membersMeta, mode),
      );
      await workspaceApi.saveFileForAgent(
        agent.id,
        "PROFILE.md",
        buildHostPROFILEMD(name.trim(), desc.trim(), membersMeta, mode),
      );

      await refreshAgents();
      message.success(t("hostModal.editSaved", "群聊已更新"));
      onSaved?.();
      onCancel();
    } catch (err: unknown) {
      setErrorText(
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : t("hostModal.editFailed", "保存失败，请稍后重试"),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        <span className={styles.modalTitle}>
          <Users2 size={18} />
          {t("hostModal.editTitle", "编辑群聊")}
        </span>
      }
      open={open}
      onCancel={handleCancel}
      footer={
        <div className={styles.modalFooter}>
          {errorText ? (
            <span className={styles.footerError}>{errorText}</span>
          ) : (
            <span />
          )}
          <Space>
            <Button onClick={handleCancel} disabled={submitting}>
              {t("common.cancel", "取消")}
            </Button>
            <Button
              type="primary"
              loading={submitting}
              onClick={handleSave}
            >
              {t("common.save", "保存")}
            </Button>
          </Space>
        </div>
      }
      centered
      width={680}
      className={styles.modalRoot}
      destroyOnClose
    >
      <Form layout="vertical" className={styles.form}>
        <Form.Item
          label={t("hostModal.nameLabel", "群聊名称")}
          required
        >
          <Input
            maxLength={40}
            showCount
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：仲裁案件专家讨论会"
          />
        </Form.Item>
        <Form.Item label={t("hostModal.descLabel", "群聊描述（可选）")}>
          <TextArea
            rows={2}
            maxLength={200}
            showCount
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="简要介绍这个群聊主要讨论哪些议题"
          />
        </Form.Item>

        <Form.Item label={t("hostModal.step2", "成员")} required>
          <div className={styles.membersToolbar}>
            <Checkbox
              checked={
                memberCandidates.length > 0 &&
                selectedIds.length === memberCandidates.length
              }
              indeterminate={
                selectedIds.length > 0 &&
                selectedIds.length < memberCandidates.length
              }
              onChange={(e) => toggleAll(e.target.checked)}
            >
              {t("hostModal.selectAll", "全选")}
            </Checkbox>
            <span className={styles.membersCountHint}>
              已选 <strong>{selectedIds.length}</strong> /{" "}
              {memberCandidates.length}
            </span>
          </div>
          {memberCandidates.length === 0 ? (
            <Empty
              description={t(
                "hostModal.noCandidates",
                "当前还没有可选的成员智能体。",
              )}
              style={{ marginTop: 24 }}
            />
          ) : (
            <div className={styles.membersGrid}>
              {memberCandidates.map((candidate) => {
                const checked = selectedIds.includes(candidate.id);
                return (
                  <div
                    key={candidate.id}
                    className={`${styles.memberCard}${
                      checked ? ` ${styles.memberCardChecked}` : ""
                    }`}
                    onClick={() => {
                      const willCheck = !checked;
                      setSelectedIds((prev) =>
                        willCheck
                          ? [...prev, candidate.id]
                          : prev.filter((x) => x !== candidate.id),
                      );
                    }}
                  >
                    <Checkbox
                      checked={checked}
                      onChange={toggleMember(candidate.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <Avatar
                      size={32}
                      style={{
                        backgroundColor: agentAvatarColor(candidate.name),
                        flexShrink: 0,
                      }}
                    >
                      {agentInitial(candidate.name)}
                    </Avatar>
                    <div className={styles.memberCardText}>
                      <div className={styles.memberCardName}>
                        {candidate.name}
                        {!candidate.enabled && (
                          <span className={styles.disabledTag}>已禁用</span>
                        )}
                      </div>
                      <div className={styles.memberCardDesc}>
                        {candidate.description ||
                          t("agent.noDescription", "暂无描述")}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Form.Item>

        <Form.Item label={t("hostModal.step3", "讨论模式")} required>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as HostScheduleMode)}
            className={styles.modeRadioGroup}
          >
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {MODE_LIST.map((m) => (
                <Radio key={m.value} value={m.value} className={styles.modeRadio}>
                  <div className={styles.modeCardInner}>
                    <div className={styles.modeIconWrap}>{m.icon}</div>
                    <div className={styles.modeTextWrap}>
                      <div className={styles.modeTitle}>{m.label}</div>
                      <div className={styles.modeDesc}>{m.desc}</div>
                    </div>
                  </div>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>

        <Alert
          type="info"
          showIcon
          message="保存后将同步更新主持人的编排文件（AGENTS.md / PROFILE.md）。"
        />
      </Form>
    </Modal>
  );
};

export default EditGroupChatModal;
