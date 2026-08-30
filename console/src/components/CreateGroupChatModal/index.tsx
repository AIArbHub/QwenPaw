import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Form,
  Input,
  Button,
  Steps,
  Card,
  Radio,
  Avatar,
  Checkbox,
  Empty,
  Alert,
  Space,
  Tooltip,
} from "antd";
import {
  Users2,
  ListOrdered,
  Layers,
  UserRound,
  ArrowRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CheckboxChangeEvent } from "antd/es/checkbox";
import { agentsApi } from "../../api/modules/agents";
import { useAgentStore } from "../../stores/agentStore";
import type { AgentSummary } from "../../api/types/agents";
import { buildChatPath } from "../../utils/sessionRoute";
import {
  agentAvatarColor,
  agentInitial,
  buildHostAGENTSMD,
  buildHostDescription,
  buildHostPROFILEMD,
  generateHostId,
  HOST_MODE_DESC,
  HOST_MODE_LABEL,
  isHostAgent,
  type HostScheduleMode,
} from "../../utils/hostAgent";
import { isAgentAvailableInChat } from "../../utils/agentVisibility";
import styles from "./index.module.less";

const { TextArea } = Input;

interface CreateGroupChatModalProps {
  open: boolean;
  onCancel: () => void;
  /** Called after the host agent is created and the user is about to navigate. */
  onCreated?: (hostAgentId: string) => void;
  /** Router navigate function injected from the layout page. */
  navigate: (path: string) => void;
}

type StepId = 0 | 1 | 2 | 3;

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

const CreateGroupChatModal: React.FC<CreateGroupChatModalProps> = ({
  open,
  onCancel,
  onCreated,
  navigate,
}) => {
  const { t } = useTranslation();
  const { agents, refreshAgents, setSelectedAgent } = useAgentStore();

  const [step, setStep] = useState<StepId>(0);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [form] = Form.useForm();

  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<HostScheduleMode>("round_robin");

  // Refresh the agent list each time the modal opens so the member selector
  // never operates on a stale store snapshot.
  useEffect(() => {
    if (open) {
      void refreshAgents();
    }
  }, [open, refreshAgents]);

  // Candidate members: exclude host agents and app-owned execution engines
  // so the selector shows every ordinary chat agent the user expects.
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

  const canAdvance01 = groupName.trim().length > 0;
  const canAdvance12 = selectedMembers.length >= 2;

  // ── Handlers ───────────────────────────────────────────────────────────

  const toggleMember = (id: string) => (e: CheckboxChangeEvent) => {
    setSelectedIds((prev) =>
      e.target.checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(memberCandidates.map((a) => a.id));
    } else {
      setSelectedIds([]);
    }
  };

  const reset = () => {
    setStep(0);
    setErrorText(null);
    setSubmitting(false);
    form.resetFields();
    setGroupName("");
    setGroupDesc("");
    setSelectedIds([]);
    setMode("round_robin");
  };

  const handleCancel = () => {
    if (submitting) return;
    reset();
    onCancel();
  };

  const handleCreate = async () => {
    if (!canAdvance01 || !canAdvance12) return;
    setErrorText(null);
    setSubmitting(true);
    try {
      const membersMeta = selectedMembers.map((a) => ({
        id: a.id,
        name: a.name,
      }));
      const meta = {
        members: membersMeta,
        mode,
        created_at: new Date().toISOString(),
      };
      const finalDescription = buildHostDescription(groupDesc.trim(), meta);
      const initial_md_files: Record<string, string> = {
        "AGENTS.md": buildHostAGENTSMD(
          groupName.trim(),
          membersMeta,
          mode,
        ),
        "PROFILE.md": buildHostPROFILEMD(
          groupName.trim(),
          groupDesc.trim(),
          membersMeta,
          mode,
        ),
      };

      const result = await agentsApi.createAgent({
        id: generateHostId(),
        name: groupName.trim(),
        description: finalDescription,
        language: "zh",
        initial_md_files,
      });

      // Refresh agent list and auto-select the new host
      await refreshAgents();
      setSelectedAgent(result.id);
      onCreated?.(result.id);

      // Navigate to chat and close
      reset();
      onCancel();
      navigate(buildChatPath());
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "创建失败，请稍后重试";
      setErrorText(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Renderers per step ────────────────────────────────────────────────

  const renderStep01Basic = () => (
    <Form form={form} layout="vertical" className={styles.form}>
      <Form.Item
        label={t("hostModal.nameLabel", "群聊名称")}
        name="groupName"
        rules={[{ required: true, message: "请输入群聊名称" }]}
      >
        <Input
          autoFocus
          maxLength={40}
          showCount
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="如：仲裁案件专家讨论会、合同评审组"
        />
      </Form.Item>
      <Form.Item
        label={t("hostModal.descLabel", "群聊描述（可选）")}
        name="groupDesc"
      >
        <TextArea
          rows={3}
          maxLength={200}
          showCount
          value={groupDesc}
          onChange={(e) => setGroupDesc(e.target.value)}
          placeholder="简要介绍这个群聊主要讨论哪些议题，例如「围绕建设工程施工合同争议的法律适用与事实认定问题展开讨论」"
        />
      </Form.Item>
      <Alert
        type="info"
        showIcon
        message="群聊会自动创建一位「主持人」智能体，主持人会在自己的独立工作区里组织成员讨论。"
        description="成员的个人记忆不会与群聊互相影响，你可以像和普通智能体聊天一样和主持人对话。"
      />
    </Form>
  );

  const renderStep02Members = () => (
    <div className={styles.membersStep}>
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
          已选 <strong>{selectedIds.length}</strong> / {memberCandidates.length}
          ，至少选择 2 位成员
        </span>
      </div>
      {memberCandidates.length === 0 ? (
        <Empty
          description={t(
            "hostModal.noCandidates",
            "当前还没有可选的成员智能体。请先创建至少 2 位普通智能体后再创建群聊。",
          )}
          style={{ marginTop: 40 }}
        />
      ) : (
        <div className={styles.membersGrid}>
          {memberCandidates.map((agent) => {
            const checked = selectedIds.includes(agent.id);
            return (
              <Card
                key={agent.id}
                hoverable
                className={`${styles.memberCard}${
                  checked ? ` ${styles.memberCardChecked}` : ""
                }`}
                onClick={() => {
                  const willCheck = !checked;
                  setSelectedIds((prev) =>
                    willCheck
                      ? [...prev, agent.id]
                      : prev.filter((x) => x !== agent.id),
                  );
                }}
              >
                <div className={styles.memberCardInner}>
                  <Checkbox
                    checked={checked}
                    onChange={toggleMember(agent.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <Avatar
                    size={36}
                    style={{
                      backgroundColor: agentAvatarColor(agent.name),
                      flexShrink: 0,
                    }}
                  >
                    {agentInitial(agent.name)}
                  </Avatar>
                  <div className={styles.memberCardText}>
                    <div className={styles.memberCardName}>
                      {agent.name}
                      {!agent.enabled && (
                        <span className={styles.disabledTag}>已禁用</span>
                      )}
                    </div>
                    <div className={styles.memberCardDesc}>
                      {agent.description || t("agent.noDescription", "暂无描述")}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  const renderStep03Mode = () => (
    <div className={styles.modeStep}>
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
                  <div className={styles.modeTitle}>
                    {m.label}
                    <span className={styles.modeRecommended}>
                      {m.value === "autonomous" ? "（推荐，最灵活）" : ""}
                      {m.value === "round_robin" ? "（默认，最稳妥）" : ""}
                    </span>
                  </div>
                  <div className={styles.modeDesc}>{m.desc}</div>
                </div>
              </div>
            </Radio>
          ))}
        </Space>
      </Radio.Group>
    </div>
  );

  const renderStep04Confirm = () => {
    const memberList =
      selectedMembers.length > 0 ? (
        <div className={styles.confirmMemberAvatars}>
          {selectedMembers.map((m) => (
            <Tooltip title={m.name} key={m.id}>
              <Avatar
                size={32}
                style={{ backgroundColor: agentAvatarColor(m.name) }}
              >
                {agentInitial(m.name)}
              </Avatar>
            </Tooltip>
          ))}
          <div className={styles.confirmMemberCount}>
            共 {selectedMembers.length} 位成员
          </div>
        </div>
      ) : (
        <div style={{ color: "var(--text-tertiary)" }}>未选择成员</div>
      );

    return (
      <div className={styles.confirmStep}>
        <Card size="small" className={styles.confirmCard}>
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>群聊名称</span>
            <span className={styles.confirmValue}>{groupName || "（未填写）"}</span>
          </div>
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>描述</span>
            <span className={styles.confirmValue}>
              {groupDesc.trim() || "（无）"}
            </span>
          </div>
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>成员</span>
            <div className={styles.confirmValue}>{memberList}</div>
          </div>
          <div className={styles.confirmRow}>
            <span className={styles.confirmLabel}>讨论模式</span>
            <span className={styles.confirmValue}>
              {HOST_MODE_LABEL[mode]} — {HOST_MODE_DESC[mode]}
            </span>
          </div>
        </Card>
        <Alert
          type="success"
          showIcon
          icon={<Users2 size={16} />}
          message="点击「创建群聊」后，系统会："
          description={
            <ol className={styles.confirmStepsList}>
              <li>创建一个新的「主持人」智能体；</li>
              <li>在其工作区写入 AGENTS.md / PROFILE.md 编排文件；</li>
              <li>自动跳转至与主持人的聊天窗口，随时可以开始议题讨论。</li>
            </ol>
          }
        />
      </div>
    );
  };

  // ── Footer actions ─────────────────────────────────────────────────────

  const stepTitles = [
    t("hostModal.step1", "基础信息"),
    t("hostModal.step2", "选择成员"),
    t("hostModal.step3", "讨论模式"),
    t("hostModal.step4", "确认创建"),
  ];

  const footerLeft =
    errorText ? (
      <span className={styles.footerError}>{errorText}</span>
    ) : null;

  const canSubmit = canAdvance01 && canAdvance12;

  const footerRight = (
    <Space>
      <Button onClick={handleCancel} disabled={submitting}>
        {t("common.cancel", "取消")}
      </Button>
      {step > 0 && (
        <Button
          onClick={() => setStep((s) => Math.max(0, s - 1) as StepId)}
          disabled={submitting}
        >
          {t("common.previous", "上一步")}
        </Button>
      )}
      {step < 3 ? (
        <Button
          type="primary"
          icon={<ArrowRight size={14} />}
          iconPosition="end"
          disabled={
            (step === 0 && !canAdvance01) || (step === 1 && !canAdvance12)
          }
          onClick={() => setStep((s) => Math.min(3, s + 1) as StepId)}
        >
          {t("common.next", "下一步")}
        </Button>
      ) : (
        <Button
          type="primary"
          loading={submitting}
          disabled={!canSubmit}
          onClick={handleCreate}
        >
          {t("hostModal.create", "创建群聊")}
        </Button>
      )}
    </Space>
  );

  return (
    <Modal
      title={
        <span className={styles.modalTitle}>
          <Users2 size={18} />
          {t("hostModal.title", "新建群聊")}
        </span>
      }
      open={open}
      onCancel={handleCancel}
      footer={
        <div className={styles.modalFooter}>
          {footerLeft}
          {footerRight}
        </div>
      }
      centered
      width={680}
      className={styles.modalRoot}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        className={styles.stepsBar}
        items={stepTitles.map((title) => ({ title }))}
      />
      <div className={styles.stepsBody}>
        {step === 0 && renderStep01Basic()}
        {step === 1 && renderStep02Members()}
        {step === 2 && renderStep03Mode()}
        {step === 3 && renderStep04Confirm()}
      </div>
    </Modal>
  );
};

export default CreateGroupChatModal;
