/**
 * All modal dialogs for the Moot case view.
 * Consolidated from the original monolith into a single module.
 */
import { useState } from "react";
import {
  Modal,
  Form,
  Input,
  Select,
  Button,
  Space,
  Tag,
  Alert,
  Progress,
  message as antMessage,
  Typography,
  Divider,
} from "antd";
import {
  PlusOutlined,
  UsergroupAddOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  TeamOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  StarOutlined,
} from "@ant-design/icons";
import {
  ROLE_CATEGORY_LABELS,
  type RoleCategory,
  type CollaborationMode,
  type CaseTemplate,
  type ArbitrationRule,
  type DocumentTemplate,
  type MootParticipant,
  type EventType,
  type AgentSummary,
} from "@/api/modules/moot";
import {
  createDefaultCollaborationPresets,
} from "../utils";

const { TextArea } = Input;
const { Text } = Typography;

const ROLE_DETAIL_OPTIONS: Record<RoleCategory, string[]> = {
  arbitrator: ["首席仲裁员", "仲裁员", "边裁"],
  party: ["申请人", "被申请人", "第三人"],
  secretary: ["仲裁秘书"],
  controller: ["导演/上帝视角", "仲裁秘书兼任", "当事人兼任"],
};

const COLLAB_MODE_OPTIONS: { value: CollaborationMode; label: string }[] = [
  { value: "human_lead", label: "人主AI辅" },
  { value: "ai_lead", label: "人辅AI主" },
  { value: "full_ai", label: "全AI" },
  { value: "full_human", label: "全人" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Create Case Modal
// ─────────────────────────────────────────────────────────────────────────────
interface CreateCaseModalProps {
  open: boolean;
  onClose: () => void;
  templates: CaseTemplate[];
  rules: ArbitrationRule[];
  collaborationPresetId: string;
  onPresetChange: (v: string) => void;
  onCreate: (params: {
    case_name: string;
    case_description?: string;
    rules?: string[];
    templateId?: string;
  }) => Promise<void>;
  loading: boolean;
}

export function CreateCaseModal({
  open,
  onClose,
  templates,
  rules,
  collaborationPresetId,
  onPresetChange,
  onCreate,
  loading,
}: CreateCaseModalProps) {
  const [form] = Form.useForm();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const templateOptions = templates.map((t) => ({
    value: t.template_id,
    label: `${t.name} — ${t.description}`,
  }));

  const ruleOptions = rules.map((r) => ({
    value: r.name,
    label: `${r.name}（${r.edition}）`,
  }));

  const handleTemplateSelect = (value: string) => {
    setSelectedTemplateId(value);
    const tmpl = templates.find((t) => t.template_id === value);
    if (tmpl) {
      form.setFieldsValue({
        case_name: tmpl.case_name,
        case_description: tmpl.case_description,
        rules: tmpl.rules,
      });
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const parsedRules: string[] = Array.isArray(values.rules)
        ? values.rules.filter(Boolean)
        : (values.rules || "")
            .split(/[，,;；\n]/)
            .map((s: string) => s.trim())
            .filter(Boolean);
      await onCreate({
        case_name: values.case_name,
        case_description: values.case_description,
        rules: parsedRules,
        templateId: selectedTemplateId || undefined,
      });
      form.resetFields();
      setSelectedTemplateId("");
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title="新建仲裁模拟案"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        setSelectedTemplateId("");
        onClose();
      }}
      confirmLoading={loading}
      okText="确认创建"
      cancelText="取消"
      width={560}
    >
      <Form form={form} layout="vertical" initialValues={{ case_name: "仲裁模拟案" }}>
        <Form.Item label="案件模板" extra="选择模板自动填充案件信息">
          <Select
            allowClear
            placeholder="选择案件模板（可选）"
            value={selectedTemplateId || undefined}
            onChange={handleTemplateSelect}
            options={templateOptions}
          />
        </Form.Item>
        <Form.Item
          name="case_name"
          label="案件名称"
          rules={[{ required: true, message: "请输入案件名称" }]}
        >
          <Input placeholder="如：合同纠纷仲裁模拟案" />
        </Form.Item>
        <Form.Item name="case_description" label="案件描述">
          <TextArea rows={3} placeholder="简要描述案件背景、仲裁协议等" />
        </Form.Item>
        <Form.Item label="默认人机协同模式">
          <Select
            value={collaborationPresetId}
            onChange={onPresetChange}
            options={createDefaultCollaborationPresets().map((p) => ({
              value: p.id,
              label: `${p.name} · ${p.description}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="rules" label="仲裁规则">
          <Select
            mode="tags"
            placeholder="选择或输入仲裁规则"
            options={ruleOptions}
            tokenSeparators={["，", ",", "；", ";"]}
          />
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 12 }}>
        创建案件后，可逐步添加参与者、推进程序阶段。无需在创建时确定所有细节。
      </Text>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Participant Modal
// ─────────────────────────────────────────────────────────────────────────────
interface AddParticipantModalProps {
  open: boolean;
  onClose: () => void;
  availableAgents: AgentSummary[];
  onAdd: (params: {
    agent_id?: string;
    new_agent_name?: string;
    new_agent_description?: string;
    display_name: string;
    role: RoleCategory;
    role_detail?: string;
    collaboration_mode?: CollaborationMode;
  }) => Promise<void>;
  loading: boolean;
  title?: string;
}

export function AddParticipantModal({
  open,
  onClose,
  availableAgents,
  onAdd,
  loading,
  title = "添加参与者",
}: AddParticipantModalProps) {
  const [form] = Form.useForm();

  const agentOptions = availableAgents.map((a) => ({
    value: a.id,
    label: a.name + (a.description ? ` — ${a.description.slice(0, 30)}` : ""),
  }));

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onAdd({
        agent_id: values.agent_id || undefined,
        new_agent_name: !values.agent_id ? values.new_agent_name : undefined,
        new_agent_description: !values.agent_id
          ? values.new_agent_description
          : undefined,
        display_name: values.display_name,
        role: values.role,
        role_detail: values.role_detail || "",
        collaboration_mode: values.collaboration_mode || "ai_lead",
      });
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      width={520}
    >
      <Form form={form} layout="vertical" initialValues={{ role: "party", collaboration_mode: "ai_lead" }}>
        <Form.Item name="agent_id" label="关联智能体">
          <Select
            showSearch
            allowClear
            placeholder="选择已有智能体（或下方新建）"
            options={agentOptions}
            filterOption={(input, option) =>
              (option?.label || "").toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.agent_id !== cur.agent_id}>
          {({ getFieldValue }) =>
            !getFieldValue("agent_id") ? (
              <>
                <Form.Item name="new_agent_name" label="新智能体名称">
                  <Input placeholder="输入名称以创建新智能体" />
                </Form.Item>
                <Form.Item name="new_agent_description" label="智能体描述">
                  <Input placeholder="简要描述（可选）" />
                </Form.Item>
              </>
            ) : null
          }
        </Form.Item>
        <Form.Item name="display_name" label="显示名称" rules={[{ required: true, message: "请输入显示名称" }]}>
          <Input placeholder="如：首席仲裁员" />
        </Form.Item>
        <Form.Item name="role" label="角色类别" rules={[{ required: true }]}>
          <Select
            options={(Object.keys(ROLE_CATEGORY_LABELS) as RoleCategory[]).map((r) => ({
              value: r,
              label: ROLE_CATEGORY_LABELS[r],
            }))}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, cur) => prev.role !== cur.role}>
          {({ getFieldValue }) => {
            const role = getFieldValue("role") as RoleCategory;
            const details = ROLE_DETAIL_OPTIONS[role] || [];
            return details.length > 0 ? (
              <Form.Item name="role_detail" label="角色细项">
                <Select
                  allowClear
                  placeholder="选择角色细项"
                  options={details.map((d) => ({ value: d, label: d }))}
                />
              </Form.Item>
            ) : null;
          }}
        </Form.Item>
        <Form.Item name="collaboration_mode" label="协同模式">
          <Select options={COLLAB_MODE_OPTIONS} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add Party Modal (for ongoing cases)
// ─────────────────────────────────────────────────────────────────────────────
interface AddPartyModalProps {
  open: boolean;
  onClose: () => void;
  availableAgents: AgentSummary[];
  onAdd: (params: {
    agent_id?: string;
    new_agent_name?: string;
    new_agent_description?: string;
    display_name: string;
    role: RoleCategory;
    role_detail?: string;
    collaboration_mode?: CollaborationMode;
  }) => Promise<void>;
  loading: boolean;
}

export function AddPartyModal(props: AddPartyModalProps) {
  return (
    <AddParticipantModal
      {...props}
      title="新增当事人"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Procedural Application Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ProcAppModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    eventType: EventType,
    description: string,
    actorParticipantId?: string,
  ) => Promise<void>;
  loading: boolean;
}

export function ProcAppModal({ open, onClose, onSubmit, loading }: ProcAppModalProps) {
  const [form] = Form.useForm();

  const appTypes: { value: EventType; label: string }[] = [
    { value: "jurisdiction_objection", label: "管辖权异议" },
    { value: "challenge", label: "回避申请" },
    { value: "appraisal", label: "鉴定申请" },
    { value: "merger", label: "合并审理申请" },
  ];

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(
        values.event_type,
        values.description,
        values.actor_participant_id,
      );
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title="提交程序申请"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="event_type" label="申请类型" rules={[{ required: true }]}>
          <Select options={appTypes} placeholder="选择申请类型" />
        </Form.Item>
        <Form.Item name="description" label="申请内容" rules={[{ required: true, message: "请输入申请内容" }]}>
          <TextArea rows={4} placeholder="详细描述申请理由和请求..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Rules Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ChangeRulesModalProps {
  open: boolean;
  onClose: () => void;
  currentRules: string[];
  rules: ArbitrationRule[];
  onSubmit: (rules?: string[], description?: string) => Promise<void>;
  loading: boolean;
}

export function ChangeRulesModal({
  open,
  onClose,
  currentRules,
  rules,
  onSubmit,
  loading,
}: ChangeRulesModalProps) {
  const [form] = Form.useForm();

  const ruleOptions = rules.map((r) => ({
    value: r.name,
    label: `${r.name}（${r.edition}）`,
  }));

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const parsedRules: string[] = Array.isArray(values.rules)
        ? values.rules.filter(Boolean)
        : [];
      await onSubmit(parsedRules, values.description);
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title="变更仲裁规则"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ rules: currentRules }}
      >
        <Form.Item name="rules" label="仲裁规则">
          <Select
            mode="tags"
            placeholder="选择或输入规则"
            options={ruleOptions}
            tokenSeparators={["，", ",", "；", ";"]}
          />
        </Form.Item>
        <Form.Item name="description" label="变更说明">
          <TextArea rows={3} placeholder="说明变更原因..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Tribunal Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ChangeTribunalModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (description: string, data?: Record<string, unknown>) => Promise<void>;
  loading: boolean;
}

export function ChangeTribunalModal({
  open,
  onClose,
  onSubmit,
  loading,
}: ChangeTribunalModalProps) {
  const [form] = Form.useForm();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(values.description, {
        new_size: values.new_size,
        arbitrator_type: values.arbitrator_type,
      });
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title="变更仲裁庭"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="new_size" label="仲裁庭人数" initialValue={3}>
          <Select
            options={[
              { value: 1, label: "1人庭（简易）" },
              { value: 3, label: "3人庭（普通）" },
              { value: 5, label: "5人庭（特殊）" },
            ]}
          />
        </Form.Item>
        <Form.Item name="arbitrator_type" label="仲裁员类型">
          <Select
            allowClear
            placeholder="选择仲裁员类型"
            options={[
              { value: "chief", label: "首席仲裁员" },
              { value: "co", label: "仲裁员" },
              { value: "side", label: "边裁" },
            ]}
          />
        </Form.Item>
        <Form.Item name="description" label="变更说明" rules={[{ required: true }]}>
          <TextArea rows={3} placeholder="说明变更原因..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Claims Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ChangeClaimsModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (description: string, actorParticipantId?: string) => Promise<void>;
  loading: boolean;
}

export function ChangeClaimsModal({
  open,
  onClose,
  onSubmit,
  loading,
}: ChangeClaimsModalProps) {
  const [form] = Form.useForm();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(values.description, values.actor_participant_id);
      form.resetFields();
      onClose();
    } catch (err: unknown) {
      const e = err as { errorFields?: unknown };
      if (e.errorFields) return;
    }
  };

  return (
    <Modal
      title="变更仲裁请求"
      open={open}
      onOk={handleOk}
      onCancel={() => {
        form.resetFields();
        onClose();
      }}
      confirmLoading={loading}
      width={520}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="description" label="变更内容" rules={[{ required: true }]}>
          <TextArea rows={4} placeholder="详细描述仲裁请求的变更..." />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Document Generation Modal
// ─────────────────────────────────────────────────────────────────────────────
interface DocGenModalProps {
  open: boolean;
  onClose: () => void;
  docTemplates: DocumentTemplate[];
  participants: MootParticipant[];
  onGenerate: (docType: string, participantId?: string) => Promise<string>;
}

export function DocGenModal({
  open,
  onClose,
  docTemplates,
  participants,
  onGenerate,
}: DocGenModalProps) {
  const [selectedDocType, setSelectedDocType] = useState("award");
  const [selectedPid, setSelectedPid] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [content, setContent] = useState("");

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const result = await onGenerate(selectedDocType, selectedPid || undefined);
      setContent(result);
      if (!result) {
        antMessage.warning("生成内容为空");
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      antMessage.success("已复制到剪贴板");
    }
  };

  return (
    <Modal
      title="生成法律文书"
      open={open}
      onCancel={() => {
        setContent("");
        onClose();
      }}
      footer={[
        <Button key="close" onClick={() => { setContent(""); onClose(); }}>
          关闭
        </Button>,
        <Button
          key="copy"
          icon={<CopyOutlined />}
          onClick={handleCopy}
          disabled={!content}
        >
          复制
        </Button>,
        <Button
          key="gen"
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={generating}
          onClick={handleGenerate}
        >
          生成
        </Button>,
      ]}
      width={720}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div style={{ display: "flex", gap: 8 }}>
          <Select
            style={{ flex: 1 }}
            value={selectedDocType}
            onChange={setSelectedDocType}
            options={docTemplates.map((d) => ({
              value: d.doc_type,
              label: d.name,
            }))}
          />
          <Select
            style={{ width: 200 }}
            allowClear
            placeholder="选择参与者（可选）"
            value={selectedPid || undefined}
            onChange={setSelectedPid}
            options={participants.map((p) => ({
              value: p.participant_id,
              label: p.display_name,
            }))}
          />
        </div>
        {content ? (
          <div
            style={{
              background: "var(--ant-color-bg-layout)",
              padding: 16,
              borderRadius: 8,
              maxHeight: 400,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            {content}
          </div>
        ) : (
          <Alert
            type="info"
            message="选择文书类型后点击「生成」，AI将基于案件上下文生成法律文书。"
          />
        )}
      </Space>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Score Participant Modal
// ─────────────────────────────────────────────────────────────────────────────
interface ScoreModalProps {
  open: boolean;
  onClose: () => void;
  participants: MootParticipant[];
  onScore: (participantId: string, dimensionId?: string) => Promise<
    Array<{
      dimension_id: string;
      dimension_name: string;
      score: number;
      reason: string;
    }>
  >;
}

export function ScoreModal({
  open,
  onClose,
  participants,
  onScore,
}: ScoreModalProps) {
  const [selectedPid, setSelectedPid] = useState("");
  const [scoring, setScoring] = useState(false);
  const [results, setResults] = useState<
    Array<{
      dimension_id: string;
      dimension_name: string;
      score: number;
      reason: string;
    }>
  >([]);

  const handleScore = async () => {
    if (!selectedPid) return;
    setScoring(true);
    try {
      const res = await onScore(selectedPid);
      setResults(res);
    } finally {
      setScoring(false);
    }
  };

  const avgScore =
    results.length > 0
      ? (results.reduce((sum, r) => sum + r.score, 0) / results.length).toFixed(1)
      : "—";

  return (
    <Modal
      title="参与者评分"
      open={open}
      onCancel={() => {
        setResults([]);
        onClose();
      }}
      footer={[
        <Button key="close" onClick={() => { setResults([]); onClose(); }}>
          关闭
        </Button>,
        <Button
          key="score"
          type="primary"
          icon={<StarOutlined />}
          loading={scoring}
          onClick={handleScore}
          disabled={!selectedPid}
        >
          开始评分
        </Button>,
      ]}
      width={640}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Select
          style={{ width: "100%" }}
          placeholder="选择参与者"
          value={selectedPid || undefined}
          onChange={setSelectedPid}
          options={participants.map((p) => ({
            value: p.participant_id,
            label: `${p.display_name} (${p.role_detail || p.role})`,
          }))}
        />
        {results.length > 0 && (
          <>
            <div style={{ textAlign: "center", padding: 16 }}>
              <div style={{ fontSize: 36, fontWeight: 700, color: "#1677ff" }}>
                {avgScore}
              </div>
              <Text type="secondary">综合评分（满分10分）</Text>
            </div>
            <Divider style={{ margin: "8px 0" }} />
            {results.map((r) => (
              <div key={r.dimension_id}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <Text strong>{r.dimension_name}</Text>
                  <Tag
                    color={
                      r.score >= 7 ? "green" : r.score >= 5 ? "gold" : "red"
                    }
                  >
                    {r.score} / 10
                  </Tag>
                </div>
                <Progress
                  percent={r.score * 10}
                  strokeColor={
                    r.score >= 7 ? "#52c41a" : r.score >= 5 ? "#faad14" : "#ff4d4f"
                  }
                  size="small"
                  showInfo={false}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {r.reason}
                </Text>
              </div>
            ))}
          </>
        )}
      </Space>
    </Modal>
  );
}
