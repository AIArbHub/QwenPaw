import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Radio,
  Space,
  Tag,
  Alert,
  message,
  Tooltip,
  Spin,
  Empty,
  Segmented,
  Typography,
  Table,
  Drawer,
  Modal,
  Form,
  Switch,
  Popconfirm,
  Upload,
  Divider,
  Timeline,
  Statistic,
  Row,
  Col,
  Card,
} from "antd";
import {
  ThunderboltOutlined,
  CopyOutlined,
  FileTextOutlined,
  SafetyOutlined,
  DiffOutlined,
  DatabaseOutlined,
  LockOutlined,
  CloudServerOutlined,
  DesktopOutlined,
  SettingOutlined,
  HistoryOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  UploadOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import type { UploadFile } from "antd";
import { knowledgeApi } from "@/api/modules/knowledge";
import type { CodenameEntry } from "@/api/modules/knowledge";
import MaterialSelector, { type SelectedMaterial } from "./components/MaterialSelector";
import styles from "./documents.module.less";

const { Text, Title, Paragraph } = Typography;

type DesensitizeMode = "local" | "local_ai" | "ai";
type ViewMode = "result" | "diff";

interface DesensitizeResult {
  original_text: string;
  desensitized_text: string;
  backfill_map: Record<string, string>;
  replacements: number;
  mode: string;
}

interface DesensitizeRuleRow {
  name: string;
  pattern: string;
  placeholder: string;
  group: number;
  enabled: boolean;
}

interface HistoryEntry {
  id: string;
  timestamp: number;
  mode: string;
  replacements: number;
  text_preview: string;
  backfill_count: number;
}

const SAMPLE_TEXT = `申请人：张三，身份证号110101199001011234，手机号13800138000，邮箱zhangsan@example.com
被申请人：李四，身份证号440305198512065678，电话13900139000，地址：深圳市福田区福华路1号大中华国际交易广场18楼1801室
案号：（2024）京仲案字第00001号
申请人因与被申请人之间的买卖合同纠纷一案，向北京仲裁委员会申请仲裁。
被申请人的银行账户为：中国建设银行深圳分行 6227 0033 8888 9999 888
法定代表人：王五，统一社会信用代码：91440300MA5DQXXXXX`;

const HISTORY_KEY = "aiarb.desensitize.history";
const MAX_HISTORY = 50;

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch {
    // ignore quota errors
  }
}

export default function DesensitizeWorkspace() {
  const { t } = useTranslation();
  const [inputText, setInputText] = useState("");
  const [mode, setMode] = useState<DesensitizeMode>("local_ai");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DesensitizeResult | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("result");
  const [materialSelectorOpen, setMaterialSelectorOpen] = useState(false);
  const [selectedMaterials, setSelectedMaterials] = useState<SelectedMaterial[]>([]);
  const [codenameDrawerOpen, setCodenameDrawerOpen] = useState(false);
  const [codenameEntries, setCodenameEntries] = useState<CodenameEntry[]>([]);
  const [codenameLoading, setCodenameLoading] = useState(false);

  // ── Rule management ──
  const [ruleDrawerOpen, setRuleDrawerOpen] = useState(false);
  const [rules, setRules] = useState<DesensitizeRuleRow[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DesensitizeRuleRow | null>(null);
  const [ruleForm] = Form.useForm();
  const [aiGenOpen, setAiGenOpen] = useState(false);
  const [aiGenDesc, setAiGenDesc] = useState("");
  const [aiGenLoading, setAiGenLoading] = useState(false);

  // ── History ──
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── File upload ──
  const [uploadingFile, setUploadingFile] = useState(false);
  const uploadRef = useRef<UploadFile[]>([]);

  // Load history on mount
  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  // ── Run desensitization ──
  const handleRun = useCallback(async () => {
    if (!inputText.trim()) {
      message.warning(t("documents.desens.inputEmpty", "请输入需要脱敏的文本"));
      return;
    }
    setRunning(true);
    try {
      const res = await knowledgeApi.desensitizeText({
        text: inputText,
        mode,
      });
      setResult(res);
      setViewMode("result");
      message.success(
        t("documents.desens.success", "脱敏完成，共替换 {{count}} 处", {
          count: res.replacements,
        }),
      );

      // Save to history
      const entry: HistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: Date.now(),
        mode,
        replacements: res.replacements,
        text_preview: inputText.slice(0, 200),
        backfill_count: Object.keys(res.backfill_map).length,
      };
      const newHistory = [entry, ...history].slice(0, MAX_HISTORY);
      setHistory(newHistory);
      saveHistory(newHistory);
    } catch (err) {
      message.error(t("documents.desens.failed", "脱敏失败"));
      console.error("Desensitize error:", err);
    } finally {
      setRunning(false);
    }
  }, [inputText, mode, t, history]);

  // ── Load codename entries ──
  const loadCodenameEntries = useCallback(async () => {
    setCodenameLoading(true);
    try {
      const res = await knowledgeApi.getCodenameMap();
      setCodenameEntries(res.entries || []);
    } catch {
      setCodenameEntries([]);
    } finally {
      setCodenameLoading(false);
    }
  }, []);

  // ── Load rules ──
  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await knowledgeApi.getDesensitizeRules();
      setRules(
        res.rules.map((r) => ({ ...r, enabled: true })),
      );
    } catch {
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  // ── Handle material selection ──
  const handleMaterialConfirm = useCallback(
    async (materials: SelectedMaterial[]) => {
      setSelectedMaterials(materials);
      setMaterialSelectorOpen(false);
      if (materials.length === 0) return;

      // Load desensitized content from selected materials
      try {
        const texts: string[] = [];
        for (const m of materials) {
          const res = await knowledgeApi.getDesensitizedContent(m.docId);
          if (res.content) {
            texts.push(`# ${m.name}\n\n${res.content}`);
          }
        }
        setInputText(texts.join("\n\n---\n\n"));
        message.success(
          t("documents.desens.materialsLoaded", "已加载 {{count}} 份材料", {
            count: materials.length,
          }),
        );
      } catch {
        message.error(t("documents.desens.loadMaterialsFailed", "加载材料失败"));
      }
    },
    [t],
  );

  // ── Handle file upload ──
  const handleFileUpload = useCallback(
    async (file: File) => {
      setUploadingFile(true);
      try {
        const res = await knowledgeApi.parseFile(file);
        if (res.text) {
          setInputText((prev) => {
            const header = `# ${res.filename || file.name}\n\n`;
            return prev ? `${prev}\n\n---\n\n${header}${res.text}` : `${header}${res.text}`;
          });
          message.success(
            t("documents.desens.fileParsed", "文件解析完成，共 {{chars}} 字符", {
              chars: res.chars,
            }),
          );
        }
      } catch (err) {
        message.error(t("documents.desens.fileParseFailed", "文件解析失败"));
        console.error("File parse error:", err);
      } finally {
        setUploadingFile(false);
      }
      return false; // Prevent antd auto upload
    },
    [t],
  );

  // ── Copy result ──
  const handleCopy = () => {
    if (result?.desensitized_text) {
      navigator.clipboard.writeText(result.desensitized_text);
      message.success(t("documents.desens.copied", "已复制到剪贴板"));
    }
  };

  // ── Rule management actions ──
  const handleSaveRules = useCallback(
    async (updatedRules: DesensitizeRuleRow[]) => {
      try {
        const payload = updatedRules
          .filter((r) => r.enabled)
          .map(({ name, pattern, placeholder, group }) => ({
            name,
            pattern,
            placeholder,
            group,
          }));
        await knowledgeApi.updateDesensitizeRules(payload);
        setRules(updatedRules);
        message.success(t("documents.desens.rulesSaved", "规则已保存"));
      } catch {
        message.error(t("documents.desens.rulesSaveFailed", "规则保存失败"));
      }
    },
    [t],
  );

  const handleToggleRule = useCallback(
    (name: string, enabled: boolean) => {
      const updated = rules.map((r) =>
        r.name === name ? { ...r, enabled } : r,
      );
      handleSaveRules(updated);
    },
    [rules, handleSaveRules],
  );

  const handleDeleteRule = useCallback(
    (name: string) => {
      const updated = rules.filter((r) => r.name !== name);
      handleSaveRules(updated);
    },
    [rules, handleSaveRules],
  );

  const handleEditRule = (rule: DesensitizeRuleRow) => {
    setEditingRule(rule);
    ruleForm.setFieldsValue(rule);
    setRuleModalOpen(true);
  };

  const handleAddRule = () => {
    setEditingRule(null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({
      placeholder: "CUSTOM_{seq:03d}",
      group: 0,
    });
    setRuleModalOpen(true);
  };

  const handleSaveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      let updated: DesensitizeRuleRow[];
      if (editingRule) {
        updated = rules.map((r) =>
          r.name === editingRule.name ? { ...values, enabled: r.enabled } : r,
        );
      } else {
        updated = [...rules, { ...values, enabled: true }];
      }
      await handleSaveRules(updated);
      setRuleModalOpen(false);
    } catch {
      // validation error
    }
  };

  const handleResetRules = async () => {
    try {
      const res = await knowledgeApi.resetDesensitizeRules();
      setRules(res.rules.map((r) => ({ ...r, enabled: true })));
      message.success(t("documents.desens.rulesReset", "规则已重置为默认"));
    } catch {
      message.error(t("documents.desens.rulesResetFailed", "重置失败"));
    }
  };

  const handleAiGenerate = async () => {
    if (!aiGenDesc.trim()) {
      message.warning(t("documents.desens.aiGenDescRequired", "请描述需要脱敏的内容类型"));
      return;
    }
    setAiGenLoading(true);
    try {
      const res = await knowledgeApi.generateAIRules(aiGenDesc);
      if (res.rules && res.rules.length > 0) {
        const newRules = res.rules.map((r) => ({ ...r, enabled: true }));
        const existingNames = new Set(rules.map((r) => r.name));
        const toAdd = newRules.filter((r) => !existingNames.has(r.name));
        if (toAdd.length > 0) {
          const updated = [...rules, ...toAdd];
          await handleSaveRules(updated);
        }
        setAiGenOpen(false);
        setAiGenDesc("");
        message.success(
          t("documents.desens.aiGenSuccess", "AI 生成了 {{count}} 条规则", {
            count: res.rules.length,
          }),
        );
      } else {
        message.info(t("documents.desens.aiGenEmpty", "AI 未生成有效规则"));
      }
    } catch {
      message.error(t("documents.desens.aiGenFailed", "AI 生成失败"));
    } finally {
      setAiGenLoading(false);
    }
  };

  // ── Render diff view ──
  const renderDiff = useMemo(() => {
    if (!result) return null;
    const origLines = result.original_text.split("\n");
    const desensLines = result.desensitized_text.split("\n");
    const maxLines = Math.max(origLines.length, desensLines.length);
    const lines: React.ReactNode[] = [];

    for (let i = 0; i < maxLines; i++) {
      const orig = origLines[i] || "";
      const desens = desensLines[i] || "";
      if (orig === desens) {
        lines.push(
          <div key={i} className={styles.diffLineSame}>
            <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text> {orig}
          </div>,
        );
      } else {
        if (orig) {
          lines.push(
            <div key={`o-${i}`} className={styles.diffLineRemoved}>
              <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>{" "}
              <Text delete style={{ color: "#ff4d4f" }}>{orig}</Text>
            </div>,
          );
        }
        if (desens) {
          lines.push(
            <div key={`d-${i}`} className={styles.diffLineAdded}>
              <Text type="secondary" style={{ fontSize: 11 }}>{i + 1}</Text>{" "}
              <Text style={{ color: "#52c41a" }}>{desens}</Text>
            </div>,
          );
        }
      }
    }
    return <div className={styles.diffContainer}>{lines}</div>;
  }, [result]);

  // ── Codename table columns ──
  const codenameColumns = [
    {
      title: t("documents.desens.codename", "代号"),
      dataIndex: "codename",
      width: 120,
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    {
      title: t("documents.desens.original", "原始值"),
      dataIndex: "original",
      ellipsis: true,
    },
    {
      title: t("documents.desens.entityType", "实体类型"),
      dataIndex: "entity_type",
      width: 100,
      render: (v: string) => <Tag>{v || "—"}</Tag>,
    },
    {
      title: t("documents.desens.aliases", "别名"),
      dataIndex: "aliases",
      render: (v: string[]) =>
        v?.length > 0 ? (
          <Space size={4} wrap>
            {v.map((a, i) => (
              <Tag key={i} style={{ fontSize: 11 }}>{a}</Tag>
            ))}
          </Space>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];

  // ── Rule table columns ──
  const ruleColumns = [
    {
      title: t("documents.desens.ruleName", "规则名称"),
      dataIndex: "name",
      width: 140,
      render: (v: string) => <Tag color="cyan">{v}</Tag>,
    },
    {
      title: t("documents.desens.rulePattern", "正则表达式"),
      dataIndex: "pattern",
      ellipsis: true,
      render: (v: string) => (
        <Text code style={{ fontSize: 12 }}>{v}</Text>
      ),
    },
    {
      title: t("documents.desens.rulePlaceholder", "占位符"),
      dataIndex: "placeholder",
      width: 140,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: t("documents.desens.ruleGroup", "捕获组"),
      dataIndex: "group",
      width: 80,
    },
    {
      title: t("documents.desens.ruleEnabled", "启用"),
      dataIndex: "enabled",
      width: 70,
      render: (v: boolean, _record: DesensitizeRuleRow) => (
        <Switch
          size="small"
          checked={v}
          onChange={(checked) => handleToggleRule(_record.name, checked)}
        />
      ),
    },
    {
      title: t("common.actions", "操作"),
      width: 100,
      render: (_: unknown, record: DesensitizeRuleRow) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEditRule(record)}
          />
          <Popconfirm
            title={t("documents.desens.confirmDeleteRule", "确定删除此规则？")}
            onConfirm={() => handleDeleteRule(record.name)}
          >
            <Button type="text" size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Backfill map entries from result ──
  const backfillEntries = useMemo(() => {
    if (!result?.backfill_map) return [];
    return Object.entries(result.backfill_map).map(([original, codename]) => ({
      original,
      codename,
      entity_type: "",
      aliases: [] as string[],
    }));
  }, [result]);

  return (
    <div className={styles.desensWorkspace}>
      {/* ── Left: Input ── */}
      <div className={styles.desensLeft}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--ant-color-border-secondary)" }}>
          <Space style={{ marginBottom: 8, justifyContent: "space-between", width: "100%" }}>
            <Space>
              <FileTextOutlined />
              <Text strong>{t("documents.desens.input", "输入")}</Text>
            </Space>
            <Space size={4}>
              <Tooltip title={t("documents.desens.historyTitle", "脱敏记录")}>
                <Button
                  size="small"
                  type="text"
                  icon={<HistoryOutlined />}
                  onClick={() => setHistoryDrawerOpen(true)}
                />
              </Tooltip>
              <Tooltip title={t("documents.desens.rulesTitle", "脱敏规则设置")}>
                <Button
                  size="small"
                  type="text"
                  icon={<SettingOutlined />}
                  onClick={() => {
                    loadRules();
                    setRuleDrawerOpen(true);
                  }}
                />
              </Tooltip>
            </Space>
          </Space>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => setMaterialSelectorOpen(true)}
            >
              {t("documents.desens.selectFromMaterials", "从材料库选")}
            </Button>
            <Upload
              beforeUpload={handleFileUpload}
              showUploadList={false}
              accept=".txt,.md,.pdf,.doc,.docx,.jpg,.jpeg,.png,.bmp,.tiff"
              fileList={[]}
            >
              <Button
                size="small"
                icon={<UploadOutlined />}
                loading={uploadingFile}
              >
                {t("documents.desens.uploadFile", "上传文件")}
              </Button>
            </Upload>
            <Button
              size="small"
              icon={<ExperimentOutlined />}
              onClick={() => setInputText(SAMPLE_TEXT)}
            >
              {t("documents.desens.useSample", "示例文本")}
            </Button>
            {inputText && (
              <Button
                size="small"
                type="text"
                onClick={() => {
                  setInputText("");
                  setResult(null);
                }}
              >
                {t("common.clear", "清空")}
              </Button>
            )}
          </div>
          {selectedMaterials.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("documents.desens.selectedMaterials", "已选 {{count}} 份材料", {
                  count: selectedMaterials.length,
                })}
              </Text>
            </div>
          )}
        </div>

        <div className={styles.desensInputArea}>
          <Input.TextArea
            className={styles.desensTextArea}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t("documents.desens.inputPlaceholder", "粘贴需要脱敏的文本，或上传文件/从材料库选择文档...")}
            style={{ flex: 1, resize: "none" }}
          />
        </div>

        {/* Mode selector */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--ant-color-border-secondary)" }}>
          <Text strong style={{ display: "block", marginBottom: 8 }}>
            {t("documents.desens.mode", "脱敏模式")}
          </Text>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            style={{ marginBottom: 8 }}
          >
            <Radio.Button value="local">
              <LockOutlined /> {t("documents.desensMode.local", "本地正则")}
            </Radio.Button>
            <Radio.Button value="local_ai">
              <DesktopOutlined /> {t("documents.desensMode.localAi", "正则+AI")}
            </Radio.Button>
            <Radio.Button value="ai">
              <CloudServerOutlined /> {t("documents.desensMode.ai", "纯AI")}
            </Radio.Button>
          </Radio.Group>
          <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
            {mode === "local" && t("documents.desensMode.localDesc", "仅本地正则规则，零数据外泄")}
            {mode === "local_ai" && t("documents.desensMode.localAiDesc", "本地正则 + AI增强补漏（推荐）")}
            {mode === "ai" && t("documents.desensMode.aiDesc", "纯AI脱敏，精度最高但数据需上传云端")}
          </Text>
        </div>

        {/* Run button */}
        <div style={{ padding: "0 16px 12px" }}>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            onClick={handleRun}
            loading={running}
            disabled={!inputText.trim()}
            block
            size="large"
          >
            {t("documents.desens.run", "开始脱敏")}
          </Button>
        </div>
      </div>

      {/* ── Right: Output ── */}
      <div className={styles.desensRight}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--ant-color-border-secondary)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space>
            <SafetyOutlined />
            <Text strong>{t("documents.desens.output", "输出")}</Text>
            {result && (
              <Tag color="green">
                {t("documents.desens.replacements", "{{count}} 处替换", { count: result.replacements })}
              </Tag>
            )}
          </Space>
          <Space>
            {result && (
              <>
                <Segmented
                  value={viewMode}
                  onChange={(v) => setViewMode(v as ViewMode)}
                  options={[
                    { label: <Space size={2}><SafetyOutlined />{t("documents.desens.result", "结果")}</Space>, value: "result" },
                    { label: <Space size={2}><DiffOutlined />{t("documents.desens.diff", "对比")}</Space>, value: "diff" },
                  ]}
                />
                <Tooltip title={t("documents.desens.copy", "复制结果")}>
                  <Button size="small" icon={<CopyOutlined />} onClick={handleCopy} />
                </Tooltip>
                <Tooltip title={t("documents.desens.codenameMap", "代号映射表")}>
                  <Button
                    size="small"
                    icon={<DatabaseOutlined />}
                    onClick={() => {
                      loadCodenameEntries();
                      setCodenameDrawerOpen(true);
                    }}
                  />
                </Tooltip>
              </>
            )}
          </Space>
        </div>

        <div className={styles.desensOutputArea}>
          {running ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Spin size="large" />
              <Text type="secondary" style={{ marginTop: 16 }}>
                {t("documents.desens.processing", "正在脱敏处理...")}
              </Text>
            </div>
          ) : !result ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
              <Empty
                description={t("documents.desens.emptyHint", "输入文本后点击「开始脱敏」查看结果")}
              />
            </div>
          ) : viewMode === "result" ? (
            <div className={styles.desensResult}>
              {result.desensitized_text}
            </div>
          ) : (
            renderDiff
          )}
        </div>

        {/* Backfill map preview */}
        {result && backfillEntries.length > 0 && (
          <div style={{ padding: "0 16px 12px", maxHeight: 200, overflowY: "auto" }}>
            <Text strong style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
              {t("documents.desens.codenameMapping", "代号映射")}
            </Text>
            <Space size={4} wrap>
              {backfillEntries.map((entry, i) => (
                <Tag key={i} style={{ fontSize: 11 }}>
                  <Text style={{ color: "#52c41a", fontWeight: 600 }}>{entry.codename}</Text>
                  {" ← "}
                  <Text type="secondary">{entry.original}</Text>
                </Tag>
              ))}
            </Space>
          </div>
        )}
      </div>

      {/* ── Material Selector ── */}
      <MaterialSelector
        open={materialSelectorOpen}
        onClose={() => setMaterialSelectorOpen(false)}
        onConfirm={handleMaterialConfirm}
      />

      {/* ── Codename Map Drawer ── */}
      <Drawer
        title={
          <Space>
            <DatabaseOutlined />
            {t("documents.desens.codenameMap", "代号映射表")}
          </Space>
        }
        open={codenameDrawerOpen}
        onClose={() => setCodenameDrawerOpen(false)}
        width={640}
      >
        <Alert
          type="info"
          showIcon
          message={t("documents.desens.codenameMapHint", "代号脱离角色，角色作为属性。代号（当事人一、当事人二）全局不变，角色标注随语境变化。")}
          style={{ marginBottom: 12 }}
        />
        <Spin spinning={codenameLoading}>
          {codenameEntries.length > 0 ? (
            <Table
              dataSource={codenameEntries}
              columns={codenameColumns}
              rowKey="original"
              size="small"
              pagination={{ pageSize: 10 }}
            />
          ) : (
            <Empty description={t("documents.desens.noCodenameEntries", "暂无代号映射记录")} />
          )}
        </Spin>
      </Drawer>

      {/* ── Rule Management Drawer ── */}
      <Drawer
        title={
          <Space>
            <SettingOutlined />
            {t("documents.desens.rulesTitle", "脱敏规则设置")}
          </Space>
        }
        open={ruleDrawerOpen}
        onClose={() => setRuleDrawerOpen(false)}
        width={720}
      >
        <Alert
          type="info"
          showIcon
          message={t("documents.desens.rulesHint", "脱敏规则使用正则表达式匹配敏感信息，替换为代号占位符。{seq} 会被自动替换为序号。")}
          style={{ marginBottom: 12 }}
        />
        <div style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={handleAddRule}
            >
              {t("documents.desens.addRule", "添加规则")}
            </Button>
            <Button
              icon={<ExperimentOutlined />}
              onClick={() => setAiGenOpen(true)}
            >
              {t("documents.desens.aiGenerate", "AI生成规则")}
            </Button>
          </Space>
          <Popconfirm
            title={t("documents.desens.confirmResetRules", "确定重置为默认规则？")}
            onConfirm={handleResetRules}
          >
            <Button icon={<ReloadOutlined />}>
              {t("documents.desens.resetRules", "重置默认")}
            </Button>
          </Popconfirm>
        </div>
        <Spin spinning={rulesLoading}>
          <Table
            dataSource={rules}
            columns={ruleColumns}
            rowKey="name"
            size="small"
            pagination={false}
          />
        </Spin>
      </Drawer>

      {/* ── Rule Edit/Add Modal ── */}
      <Modal
        title={editingRule ? t("documents.desens.editRule", "编辑规则") : t("documents.desens.addRule", "添加规则")}
        open={ruleModalOpen}
        onOk={handleSaveRule}
        onCancel={() => setRuleModalOpen(false)}
        destroyOnHidden
      >
        <Form form={ruleForm} layout="vertical">
          <Form.Item
            name="name"
            label={t("documents.desens.ruleName", "规则名称")}
            rules={[{ required: true, message: t("common.required", "必填") }]}
          >
            <Input placeholder="如：身份证号" />
          </Form.Item>
          <Form.Item
            name="pattern"
            label={t("documents.desens.rulePattern", "正则表达式")}
            rules={[{ required: true, message: t("common.required", "必填") }]}
          >
            <Input placeholder="如：\d{17}[\dXx]" />
          </Form.Item>
          <Form.Item
            name="placeholder"
            label={t("documents.desens.rulePlaceholder", "占位符模板")}
            tooltip="{seq} 会被替换为自动递增的序号"
          >
            <Input placeholder="如：IDCARD_{seq:03d}" />
          </Form.Item>
          <Form.Item
            name="group"
            label={t("documents.desens.ruleGroup", "捕获组序号")}
            tooltip="0 表示整个匹配，1 表示第一个括号组"
          >
            <Input type="number" min={0} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── AI Generate Rules Modal ── */}
      <Modal
        title={
          <Space>
            <ExperimentOutlined />
            {t("documents.desens.aiGenerate", "AI 生成脱敏规则")}
          </Space>
        }
        open={aiGenOpen}
        onCancel={() => setAiGenOpen(false)}
        onOk={handleAiGenerate}
        confirmLoading={aiGenLoading}
        okText={t("documents.desens.generate", "生成")}
      >
        <Alert
          type="info"
          showIcon
          message={t("documents.desens.aiGenHint", "描述你要脱敏的内容类型，AI 会自动生成对应的正则规则。例如：「仲裁案件中的当事人身份证号、银行账号、手机号」")}
          style={{ marginBottom: 12 }}
        />
        <Input.TextArea
          value={aiGenDesc}
          onChange={(e) => setAiGenDesc(e.target.value)}
          rows={4}
          placeholder={t("documents.desens.aiGenPlaceholder", "描述需要脱敏的信息类型...")}
        />
      </Modal>

      {/* ── History Drawer ── */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined />
            {t("documents.desens.historyTitle", "脱敏记录")}
          </Space>
        }
        open={historyDrawerOpen}
        onClose={() => setHistoryDrawerOpen(false)}
        width={560}
      >
        {history.length === 0 ? (
          <Empty description={t("documents.desens.noHistory", "暂无脱敏记录")} />
        ) : (
          <>
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Statistic
                  title={t("documents.desens.totalOperations", "总操作次数")}
                  value={history.length}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={t("documents.desens.totalReplacements", "总替换数")}
                  value={history.reduce((sum, h) => sum + h.replacements, 0)}
                />
              </Col>
              <Col span={8}>
                <Statistic
                  title={t("documents.desens.lastMode", "最近模式")}
                  value={history[0]?.mode || "—"}
                />
              </Col>
            </Row>
            <Divider />
            <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
              {history.map((entry) => (
                <Card
                  key={entry.id}
                  size="small"
                  style={{ marginBottom: 8 }}
                  hoverable
                  onClick={() => {
                    setInputText(entry.text_preview);
                    setHistoryDrawerOpen(false);
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Space>
                      <Tag color={
                        entry.mode === "local" ? "default" :
                        entry.mode === "local_ai" ? "blue" : "purple"
                      }>
                        {entry.mode}
                      </Tag>
                      <Tag color="green">
                        {entry.replacements} 处替换
                      </Tag>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {new Date(entry.timestamp).toLocaleString("zh-CN")}
                    </Text>
                  </div>
                  <Paragraph
                    type="secondary"
                    ellipsis={{ rows: 2 }}
                    style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}
                  >
                    {entry.text_preview}
                  </Paragraph>
                </Card>
              ))}
            </div>
            <Divider />
            <Popconfirm
              title={t("documents.desens.confirmClearHistory", "确定清空所有脱敏记录？")}
              onConfirm={() => {
                setHistory([]);
                saveHistory([]);
                message.success(t("documents.desens.historyCleared", "记录已清空"));
              }}
            >
              <Button danger block icon={<DeleteOutlined />}>
                {t("documents.desens.clearHistory", "清空记录")}
              </Button>
            </Popconfirm>
          </>
        )}
      </Drawer>
    </div>
  );
}