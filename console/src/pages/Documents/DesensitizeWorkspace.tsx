import { useState, useCallback, useMemo } from "react";
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
} from "antd";
import {
  ThunderboltOutlined,
  CopyOutlined,
  SaveOutlined,
  FileTextOutlined,
  SafetyOutlined,
  DiffOutlined,
  DatabaseOutlined,
  LockOutlined,
  CloudServerOutlined,
  DesktopOutlined,
} from "@ant-design/icons";
import { knowledgeApi } from "@/api/modules/knowledge";
import type { CodenameEntry } from "@/api/modules/knowledge";
import MaterialSelector, { type SelectedMaterial } from "./components/MaterialSelector";
import styles from "./documents.module.less";

const { Text, Title } = Typography;

type DesensitizeMode = "local" | "local_ai" | "ai";
type ViewMode = "result" | "diff";

interface DesensitizeResult {
  original_text: string;
  desensitized_text: string;
  backfill_map: Record<string, string>;
  replacements: number;
  mode: string;
}

const SAMPLE_TEXT = `申请人：张三，身份证号110101199001011234，手机号13800138000，邮箱zhangsan@example.com
被申请人：李四，身份证号440305198512065678，电话13900139000，地址：深圳市福田区福华路1号大中华国际交易广场18楼1801室
案号：（2024）京仲案字第00001号
申请人因与被申请人之间的买卖合同纠纷一案，向北京仲裁委员会申请仲裁。
被申请人的银行账户为：中国建设银行深圳分行 6227 0033 8888 9999 888
法定代表人：王五，统一社会信用代码：91440300MA5DQXXXXX`;

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
    } catch (err) {
      message.error(t("documents.desens.failed", "脱敏失败"));
      console.error("Desensitize error:", err);
    } finally {
      setRunning(false);
    }
  }, [inputText, mode, t]);

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

  // ── Copy result ──
  const handleCopy = () => {
    if (result?.desensitized_text) {
      navigator.clipboard.writeText(result.desensitized_text);
      message.success(t("documents.desens.copied", "已复制到剪贴板"));
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
          <Space style={{ marginBottom: 8 }}>
            <FileTextOutlined />
            <Text strong>{t("documents.desens.input", "输入")}</Text>
          </Space>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              size="small"
              icon={<DatabaseOutlined />}
              onClick={() => setMaterialSelectorOpen(true)}
            >
              {t("documents.desens.selectFromMaterials", "从材料库选")}
            </Button>
            <Button
              size="small"
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
        </div>

        <div className={styles.desensInputArea}>
          <Input.TextArea
            className={styles.desensTextArea}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={t("documents.desens.inputPlaceholder", "粘贴需要脱敏的文本，或从材料库选择文档...")}
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
    </div>
  );
}
