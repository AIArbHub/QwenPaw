import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  EditOutlined,
  CopyOutlined,
  CheckCircleOutlined,
  SwapOutlined,
  EyeInvisibleOutlined,
  LockOutlined,
  RocketOutlined,
  SettingOutlined,
  HistoryOutlined,
  UploadOutlined,
  ArrowRightOutlined,
  QuestionCircleOutlined,
  DatabaseOutlined,
  ExportOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  DeleteOutlined,
  DownloadOutlined,
  ReloadOutlined,
  WarningOutlined,
  EyeOutlined,
  FileSearchOutlined,
} from "@ant-design/icons";
import {
  Button,
  Input,
  Tabs,
  Drawer,
  Empty,
  Alert,
  message,
  Tag,
  Space,
  Tooltip,
  Upload,
  Divider,
  Table,
  Switch,
  Select,
  Popconfirm,
  Typography,
  Badge,
  Spin,
  Modal,
  Radio,
  Checkbox,
  Collapse,
  Card,
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import { knowledgeApi } from "@/api/modules/knowledge";
import FolderPicker from "@/components/FolderPicker";
import { ResizableTextArea } from "@/components/ResizableTextArea";
import styles from "./index.module.less";

const { TextArea } = Input;
const { Text } = Typography;

interface DesensitizeResult {
  original_text: string;
  desensitized_text: string;
  backfill_map: Record<string, string>;
  replacements: number;
  mode: string;
}

interface RuleItem {
  name: string;
  pattern: string;
  placeholder: string;
  group: number;
  enabled?: boolean;
}

type DesensitizeMode = "local" | "local_ai" | "ai";

const SAMPLE_TEXT = `申请人：张三，身份证号110101199001011234，手机号13800138000，邮箱zhangsan@example.com
被申请人：李四，身份证号440305198512065678，电话13900139000，地址：深圳市福田区福华路1号大中华国际交易广场18楼1801室
案号：（2024）京仲案字第00001号
申请人因与被申请人之间的买卖合同纠纷一案，向北京仲裁委员会申请仲裁。
申请人请求：1.裁决被申请人向申请人支付货款人民币50,000元；2.本案仲裁费用由被申请人承担。
经审理查明：双方于2024年1月15日签订《采购合同》，约定被申请人向申请人购买电子元器件，
合同总金额为人民币100,000元。截至起诉之日，被申请人尚欠货款人民币50,000元未支付。
被申请人的银行账户为：中国建设银行深圳分行 6227 0033 8888 9999 888
法定代表人：王五，统一社会信用代码：91440300MA5DQXXXXX
委托代理人：赵六律师，广东XX律师事务所`;

const RULE_LABELS: Record<string, { labelKey: string; color: string; category: string }> = {
  id_card: { labelKey: "ruleIdCard", color: "red", category: "证件号码" },
  phone: { labelKey: "rulePhone", color: "orange", category: "联系方式" },
  phone_with_prefix: { labelKey: "rulePhonePrefix", color: "orange", category: "联系方式" },
  bank_card: { labelKey: "ruleBankCard", color: "gold", category: "金融信息" },
  bank_account_full: { labelKey: "ruleBankAccount", color: "gold", category: "金融信息" },
  address_full: { labelKey: "ruleAddressFull", color: "blue", category: "地址位置" },
  address_simple: { labelKey: "ruleAddressSimple", color: "blue", category: "地址位置" },
  person_name_context: { labelKey: "rulePersonContext", color: "purple", category: "人员姓名" },
  person_name_plain: { labelKey: "rulePersonPlain", color: "purple", category: "人员姓名" },
  case_number: { labelKey: "ruleCaseNo", color: "cyan", category: "案件标识" },
  case_number_arbitration: { labelKey: "ruleArbCaseNo", color: "cyan", category: "案件标识" },
  email: { labelKey: "ruleEmail", color: "green", category: "联系方式" },
  company_name: { labelKey: "ruleCompany", color: "magenta", category: "组织机构" },
  vehicle_plate: { labelKey: "rulePlate", color: "geekblue", category: "财产标识" },
  passport: { labelKey: "rulePassport", color: "volcano", category: "证件号码" },
  social_credit_code: { labelKey: "ruleCreditCode", color: "lime", category: "组织机构" },
  tax_id: { labelKey: "ruleTaxId", color: "orange", category: "税务信息" },
};

const ACCEPTED_FILE_TYPES = ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.md,.csv,.json,.log,.rtf,.html,.htm";

export default function DesensitizeWorkbench() {
  const { t: _t } = useTranslation();
  const t = (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
    if (typeof fallbackOrOptions === "string") {
      return _t(`desensitize.${key}`, fallbackOrOptions, options);
    }
    return _t(`desensitize.${key}`, fallbackOrOptions);
  };
  const [activeTab, setActiveTab] = useState("workspace");
  const [selectedMode, setSelectedMode] = useState<DesensitizeMode>("local_ai");
  const [inputText, setInputText] = useState("");
  const [inputName, setInputName] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<DesensitizeResult | null>(null);
  const [copied, setCopied] = useState(false);

  // 文件/文件夹输入相关
  const [selectedFiles, setSelectedFiles] = useState<any[]>([]);
  const [showTextInput, setShowTextInput] = useState(false);
  // 输出设置
  const [outputMode, setOutputMode] = useState<"original" | "default" | "custom">("default");
  const [outputPath, setOutputPath] = useState("");
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState<"input" | "output">("input");

  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const [allRules, setAllRules] = useState<RuleItem[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  const [scanFolder, setScanFolder] = useState("");
  const [scanning, setScanning] = useState(false);

  const [taskList, setTaskList] = useState<any[]>([]);
  const [viewingTask, setViewingTask] = useState<any | null>(null);

  const [parserConfig, setParserConfig] = useState<{
    default_mode: string;
    mineru_api_key: string;
    mineru_base_url: string;
    local_ocr_enabled: boolean;
    local_ocr_lang: string;
    mineru_configured: boolean;
    paddleocr_installed: { installed: boolean; version: string | null; error?: string };
  } | null>(null);
  const [parserSaving, setParserSaving] = useState(false);
  const [ocrStatusLoading, setOcrStatusLoading] = useState(false);
  const [ocrTryLoading, setOcrTryLoading] = useState(false);
  const [ocrTryResult, setOcrTryResult] = useState<string | null>(null);
  const [ocrTryEngine, setOcrTryEngine] = useState<string>("");
  const [ocrTryError, setOcrTryError] = useState<string>("");
  const [ocrEngine, setOcrEngine] = useState<"auto" | "cloud_ocr" | "local_only">("auto");
  const [paddleInstalling, setPaddleInstalling] = useState(false);
  const [paddleInstallLog, setPaddleInstallLog] = useState<string | null>(null);
  const [paddleInstallResult, setPaddleInstallResult] = useState<{ success: boolean; message: string; platform?: string; is_arm_mac?: boolean } | null>(null);
  const isCNUser = useMemo(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      return tz.includes("Shanghai") || tz.includes("Chongqing") || tz.includes("Urumqi") || tz.includes("Harbin") || tz.includes("Hong_Kong") || tz.includes("Taipei") || tz.includes("Asia/Ulaanbaatar");
    } catch {
      return false;
    }
  }, []);
  const isMac = useMemo(() => navigator.platform?.toUpperCase().includes("MAC") || /Mac|iPod|iPhone|iPad/.test(navigator.userAgent), []);
  const pipCmd = useMemo(() => {
    const base = isCNUser
      ? "pip install paddleocr paddlepaddle -i https://pypi.tuna.tsinghua.edu.cn/simple"
      : "pip install paddleocr paddlepaddle";
    return base;
  }, [isCNUser]);

  useEffect(() => {
    knowledgeApi.getParserConfig().then(setParserConfig).catch(() => {});
  }, []);

  const refreshOcrStatus = async () => {
    setOcrStatusLoading(true);
    try {
      const res = await knowledgeApi.getOcrStatus();
      setParserConfig((prev) => prev ? { ...prev, paddleocr_installed: res.paddleocr, mineru_configured: res.mineru_configured, local_ocr_enabled: res.local_ocr_enabled } : prev);
    } catch {
      message.error(t("ocrStatusError", "检查失败"));
    } finally {
      setOcrStatusLoading(false);
    }
  };

  const handleInstallPaddleOCR = async () => {
    setPaddleInstalling(true);
    setPaddleInstallLog(null);
    setPaddleInstallResult(null);
    try {
      const res = await knowledgeApi.installPaddleOCR({
        use_mirror: isCNUser,
        mirror_url: isCNUser ? "https://pypi.tuna.tsinghua.edu.cn/simple" : undefined,
      });
      setPaddleInstallLog(res.output);
      setPaddleInstallResult({ success: res.success, message: res.message, platform: res.platform, is_arm_mac: res.is_arm_mac });
      if (res.success) {
        message.success("PaddleOCR 安装成功！");
        setParserConfig((prev) => prev ? { ...prev, paddleocr_installed: res.paddleocr_installed } : prev);
      } else {
        message.error(res.message);
      }
    } catch (err: any) {
      setPaddleInstallResult({ success: false, message: `安装请求失败：${err.message || err}` });
      message.error("安装请求失败");
    } finally {
      setPaddleInstalling(false);
    }
  };

  const handleOcrTry = async (options: any) => {
    const file = options.file as File;
    setOcrTryLoading(true);
    setOcrTryResult(null);
    setOcrTryEngine("");
    setOcrTryError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/knowledge/ocr-try?engine=${ocrEngine}`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      setOcrTryResult(data.text || "");
      setOcrTryEngine(data.engine || "");
      if (data.error) {
        setOcrTryError(data.error);
      }
    } catch {
      message.error(t("ocrTryError", "OCR 识别失败，请检查 OCR 配置"));
      setOcrTryResult("");
    } finally {
      setOcrTryLoading(false);
    }
  };

  const handleSaveParserConfig = async (updates: Record<string, unknown>) => {
    setParserSaving(true);
    try {
      const res = await knowledgeApi.updateParserConfig(updates);
      setParserConfig(res);
      message.success(t("parserConfigSaved", "OCR配置已保存"));
    } catch {
      message.error(t("parserConfigError", "保存失败"));
    } finally {
      setParserSaving(false);
    }
  };

  useEffect(() => {
    loadRules();
    loadTaskHistory();
  }, []);

  // ===== 本地持久化存储 =====
  const STORAGE_KEY = "desensitize_task_history";

  const loadTaskHistory = () => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setTaskList(parsed);
        }
      }
    } catch {
      // localStorage 解析失败，忽略
    }
  };

  const saveTaskHistory = (tasks: any[]) => {
    try {
      // 只保留最近 100 条，避免 localStorage 溢出
      const toSave = tasks.slice(0, 100);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // 存储失败（可能空间不足），静默忽略
    }
  };

  const loadRules = async () => {
    setRulesLoading(true);
    try {
      const res = await knowledgeApi.getDesensitizeRules();
      const rulesWithEnable = res.rules.map((r) => ({ ...r, enabled: true }));
      setAllRules(rulesWithEnable);
    } catch (e) {
      console.error("Failed to load rules:", e);
    } finally {
      setRulesLoading(false);
    }
  };

  const handleDesensitize = async () => {
    if (!inputText.trim()) {
      message.warning(t("inputEmpty", "请先输入需要处理的文本"));
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const enabledRules = allRules.filter((r) => r.enabled).map(({ enabled, ...rest }) => rest);
      const res = await knowledgeApi.desensitizeText({
        text: inputText,
        name: inputName || "untitled",
        mode: selectedMode,
        rules: enabledRules.length > 0 ? enabledRules : undefined,
      });
      setResult(res);
      if (res.replacements > 0) {
        message.success(t("successCount", "已完成！找到并处理了 {{count}} 处敏感信息", { count: res.replacements }));
      } else {
        message.info(t("noSensitiveFound", "未发现敏感信息，这份文本已经是安全的"));
      }
      addToTaskList(res);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (errorMsg.includes("503") || errorMsg.includes("LLM")) {
        message.error(t("llmError", "AI功能暂时不可用，请切换到「标准模式」重试，或在「设置 > 模型管理」中配置模型"));
      } else {
        message.error(t("runError", "处理失败，请稍后重试"));
      }
    } finally {
      setRunning(false);
    }
  };

  const addToTaskList = (res: DesensitizeResult) => {
    const task = {
      id: Date.now().toString(),
      name: inputName || "untitled",
      mode: selectedMode,
      replacements: res.replacements,
      createdAt: new Date().toLocaleString(),
      status: "done",
      // 保存完整结果数据，供任务列表查看
      result: {
        desensitized_text: res.desensitized_text,
        backfill_map: res.backfill_map,
        replacements: res.replacements,
      },
      inputPreview: inputText.substring(0, 200),
    };
    setTaskList((prev) => {
      const updated = [task, ...prev];
      saveTaskHistory(updated);
      return updated;
    });
  };

  const handleCopyResult = () => {
    if (!result) return;
    navigator.clipboard.writeText(result.desensitized_text).then(() => {
      setCopied(true);
      message.success(t("copiedMsg", "已复制到剪贴板"));
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleFileUpload = async (file: File) => {
    const textExts = [".txt", ".md", ".csv", ".json", ".log"];
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();

    if (textExts.includes(ext)) {
      const text = await file.text();
      setInputText(text);
      setInputName(file.name);
      message.success(t("fileLoaded", "文件「{{name}}」已加载（{{count}} 字）", { name: file.name, count: text.length }));
    } else {
      try {
        message.loading(t("processing", "正在解析文件..."), 0);
        const res = await knowledgeApi.parseFile(file);
        message.destroy();
        setInputText(res.text);
        setInputName(res.filename);
        message.success(t("fileLoaded", "文件「{{name}}」已加载（{{count}} 字）", { name: res.filename, count: res.chars }));
      } catch (err: any) {
        message.destroy();
        console.error("File parse error:", err);

        const detail = err?.response?.data?.detail || err?.message || "";
        if (detail.includes("扫描版") || detail.includes("OCR") || detail.includes("422")) {
          Modal.warning({
            title: t("pdfParseFailTitle", "无法提取文本"),
            content: (
              <div>
                <p>{t("pdfParseFailDesc", "该文件可能是扫描版PDF或图片格式，本地工具无法识别文字。")}</p>
                <p style={{ marginTop: 8, fontSize: 13 }}>
                  <strong>{t("solutionLabel", "解决方案：")}</strong>
                </p>
                <ul style={{ paddingLeft: 20, fontSize: 13, marginTop: 4 }}>
                  <li>{t("sol1", "配置MinerU API密钥以启用云端OCR功能")}</li>
                  <li>{t("sol2", "使用带有可选文字层的PDF（非扫描件）")}</li>
                  <li>{t("sol3", "手动复制粘贴文本内容到输入框")}</li>
                </ul>
              </div>
            ),
            okText: t("gotIt", "我知道了"),
          });
        } else {
          message.error(t("runError", "处理失败，请稍后重试"));
        }
      }
    }
    return false;
  };

  const handleUseSample = () => {
    setInputText(SAMPLE_TEXT);
    setInputName("示例-仲裁申请书");
    setResult(null);
  };

  const handleExportResult = () => {
    if (!result) return;
    const blob = new Blob([result.desensitized_text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${inputName || "desensitized"}_已脱敏.txt`;
    a.click();
    URL.revokeObjectURL(url);
    message.success(t("exportSuccess", "导出成功"));
  };

  const handleImportFromKnowledge = () => {
    message.info(t("comingSoon", "功能开发中：从知识库导入文档"));
  };

  const handleImportFromCases = () => {
    message.info(t("comingSoon", "功能开发中：从案件卷宗导入文档"));
  };

  const handleSendToWiki = () => {
    if (!result) return;
    message.info(t("comingSoon", "功能开发中：发送脱敏结果至Wiki编译"));
  };

  const handleToggleRule = (index: number) => {
    setAllRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleResetRules = async () => {
    await knowledgeApi.resetDesensitizeRules();
    message.success(t("rulesReset", "规则已恢复默认"));
    loadRules();
  };

  const MODE_CONFIGS: Record<DesensitizeMode, {
    icon: React.ReactNode;
    titleKey: string;
    descKey: string;
    tagKey: string;
    tagColor: string;
    features: string[];
    securityNote?: string;
    accentColor: string;
    accentBg: string;
    accentBorder: string;
  }> = {
    local: {
      icon: <SafetyCertificateOutlined />,
      titleKey: "modeLocalTitle",
      descKey: "modeLocalDesc",
      tagKey: "modeLocalTag",
      tagColor: "green",
      features: ["featureLocal1", "featureLocal2", "featureLocal3", "featureLocal4"],
      accentColor: "#52c41a",
      accentBg: "#f6ffed",
      accentBorder: "#b7eb8f",
    },
    local_ai: {
      icon: <ThunderboltOutlined />,
      titleKey: "modeHybridTitle",
      descKey: "modeHybridDesc",
      tagKey: "modeHybridTag",
      tagColor: "blue",
      features: ["featureHybrid1", "featureHybrid2", "featureHybrid3", "featureHybrid4"],
      securityNote: "modeHybridSecurity",
      accentColor: "#1677ff",
      accentBg: "#e6f4ff",
      accentBorder: "#91caff",
    },
    ai: {
      icon: <CloudOutlined />,
      titleKey: "modeAiTitle",
      descKey: "modeAiDesc",
      tagKey: "modeAiTag",
      tagColor: "orange",
      features: ["featureAi1", "featureAi2", "featureAi3"],
      securityNote: "modeAiSecurity",
      accentColor: "#fa8c16",
      accentBg: "#fff7e6",
      accentBorder: "#ffd591",
    },
  };

  const ruleColumns = [
    {
      title: t("ruleColStatus", "状态"),
      dataIndex: "enabled",
      width: 70,
      render: (enabled: boolean, _: any, index: number) => (
        <Switch size="small" checked={enabled} onChange={() => handleToggleRule(index)} />
      ),
    },
    {
      title: t("ruleColName", "规则名称"),
      dataIndex: "name",
      width: 160,
      render: (name: string) => {
        const info = RULE_LABELS[name];
        return (
          <Space>
            <span>{info ? t(info.labelKey, name) : name}</span>
            {info && (
              <Tag style={{ fontSize: 11 }} color={info.color}>
                {info.category}
              </Tag>
            )}
          </Space>
        );
      },
    },
    {
      title: t("ruleColPattern", "匹配模式"),
      dataIndex: "pattern",
      ellipsis: true,
      render: (pattern: string) => (
        <Text code style={{ fontSize: 12 }}>{pattern.slice(0, 60)}{pattern.length > 60 ? "..." : ""}</Text>
      ),
    },
    {
      title: t("ruleColPlaceholder", "替换为"),
      dataIndex: "placeholder",
      width: 140,
      render: (placeholder: string) => <Tag>{placeholder.replace("{seq:03d}", "001")}</Tag>,
    },
  ];

  const taskColumns = [
    {
      title: t("taskColName", "文件名"),
      dataIndex: "name",
      ellipsis: true,
    },
    {
      title: t("taskColMode", "处理方式"),
      dataIndex: "mode",
      width: 120,
      render: (mode: string) => {
        const map: Record<string, { label: string; color: string }> = {
          local: { label: t("modeLocalTitle"), color: "green" },
          local_ai: { label: t("modeHybridTitle"), color: "blue" },
          ai: { label: t("modeAiTitle"), color: "orange" },
        };
        const m = map[mode];
        return m ? <Tag color={m.color}>{m.label}</Tag> : mode;
      },
    },
    {
      title: t("taskColReplacements", "替换数"),
      dataIndex: "replacements",
      width: 90,
      render: (n: number) => (n > 0 ? <Badge count={n} style={{ backgroundColor: "#52c41a" }} /> : "-"),
    },
    {
      title: t("taskColTime", "时间"),
      dataIndex: "createdAt",
      width: 170,
    },
    {
      title: t("taskColActions", "操作"),
      key: "actions",
      width: 200,
      render: (_: any, record: any) => (
        <Space size={0}>
          <Tooltip title="查看脱敏结果">
            <Button
              size="small"
              type="link"
              icon={<EyeOutlined />}
              onClick={() => setViewingTask(record)}
            >
              结果
            </Button>
          </Tooltip>
          <Tooltip title="查看替换对照表">
            <Button
              size="small"
              type="link"
              icon={<SwapOutlined />}
              onClick={() => {
                setViewingTask(record);
                // 切换到对照表视图通过 Modal 内部 tab 实现
              }}
            >
              对照表
            </Button>
          </Tooltip>
          <Tooltip title="导出为 TXT">
            <Button
              size="small"
              type="link"
              icon={<DownloadOutlined />}
              onClick={() => {
                if (!record.result?.desensitized_text) {
                  message.warning("该任务无结果数据");
                  return;
                }
                const blob = new Blob([record.result.desensitized_text], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${record.name}_脱敏结果.txt`;
                a.click();
                URL.revokeObjectURL(url);
                message.success("已导出");
              }}
            >
              导出
            </Button>
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.pageContainer}>
      <PageHeader current={t("pageTitle", "脱敏")} />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className={styles.mainTabs}
        items={[
          {
            key: "workspace",
            label: (
              <span><EditOutlined /> {t("tabWorkspace", "工作台")}</span>
            ),
            children: (
              <div className={styles.workspaceContent}>
                {!inputText && !result && selectedFiles.length === 0 && (
                  <Alert
                    type="info"
                    showIcon
                    icon={<QuestionCircleOutlined />}
                    className={styles.topTip}
                    message={
                      <span>
                        <strong>{t("whatIsThis", "什么是脱敏？")}</strong>
                        {" — "}
                        {t("whatIsThisDesc", "自动识别仲裁文书中的当事人身份信息、联系方式、财务信息等敏感内容，替换为安全代号。处理后可用于培训、研究、案例分享等场景。")}
                      </span>
                    }
                  />
                )}

                {/* ===== 处理方式（卡片式三选一） ===== */}
                <div className={styles.modeSection}>
                  <div className={styles.sectionHeader}>
                    <RocketOutlined />
                    <span className={styles.sectionTitle}>{t("chooseModeTitle", "处理方式")}</span>
                  </div>
                  <div className={styles.modeCardRow}>
                    {(Object.keys(MODE_CONFIGS) as DesensitizeMode[]).map((mode) => {
                      const config = MODE_CONFIGS[mode];
                      const isActive = selectedMode === mode;
                      return (
                        <div
                          key={mode}
                          className={`${styles.modeCard} ${isActive ? styles.modeCardActive : ""}`}
                          onClick={() => setSelectedMode(mode)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && setSelectedMode(mode)}
                          style={isActive ? {
                            borderColor: config.accentColor,
                            background: config.accentBg,
                            boxShadow: `0 4px 16px ${config.accentBorder}55`,
                          } : undefined}
                        >
                          <div className={styles.modeCardTop}>
                            <div
                              className={`${styles.modeCardIcon} ${isActive ? styles.modeCardIconActive : ""}`}
                              style={isActive ? {
                                color: config.accentColor,
                                background: config.accentBg,
                                borderColor: config.accentBorder,
                              } : undefined}
                            >
                              {config.icon}
                            </div>
                            {isActive && (
                              <CheckCircleOutlined
                                className={styles.modeCardCheck}
                                style={{ color: config.accentColor }}
                              />
                            )}
                          </div>
                          <div className={styles.modeCardTitle}>{t(config.titleKey)}</div>
                          <Tag color={config.tagColor} className={styles.modeCardTag}>{t(config.tagKey)}</Tag>
                          {/* 卡片内嵌说明 */}
                          <div className={styles.modeCardDesc}>
                            {t(config.descKey)}
                          </div>
                          <div className={styles.modeCardFeatures}>
                            {config.features.map((f) => (
                              <span key={f} className={styles.modeCardFeature}>
                                <CheckCircleOutlined style={{ color: config.accentColor, fontSize: 11 }} />
                                {t(f)}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <Divider style={{ margin: "12px 0" }} />

                {/* ===== 选择文件（主要输入方式） ===== */}
                <div className={styles.inputSection}>
                  <div className={styles.sectionHeader}>
                    <FolderOpenOutlined />
                    <span className={styles.sectionTitle}>{t("inputTitle", "选择文件")}</span>
                    <div className={styles.inputActions}>
                      <Tooltip title={t("importFromKb", "从知识库导入文档")}>
                        <Button size="small" icon={<DatabaseOutlined />} onClick={handleImportFromKnowledge}>
                          {t("importKbBtn", "知识库")}
                        </Button>
                      </Tooltip>
                      <Tooltip title={t("importFromCases", "从案件卷宗导入文档")}>
                        <Button size="small" icon={<FolderOpenOutlined />} onClick={handleImportFromCases}>
                          {t("importCasesBtn", "卷宗")}
                        </Button>
                      </Tooltip>
                    </div>
                  </div>

                  {/* 文件选择区 */}
                  {selectedFiles.length === 0 ? (
                    <div className={styles.fileDropZone}>
                      <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                        <Upload
                          accept={ACCEPTED_FILE_TYPES}
                          showUploadList={false}
                          multiple
                          beforeUpload={(file, fileList) => {
                            // 处理多文件
                            if (fileList.length > 1) {
                              setSelectedFiles(fileList.map(f => ({ name: f.name, size: f.size, file: f })));
                            } else {
                              handleFileUpload(file);
                            }
                            return false;
                          }}
                        >
                          <div className={styles.fileDropCard}>
                            <UploadOutlined style={{ fontSize: 32, color: "var(--ant-color-primary)" }} />
                            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>上传文件</div>
                            <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>PDF / Word / Excel / TXT 等</div>
                          </div>
                        </Upload>
                        <div
                          className={styles.fileDropCard}
                          onClick={() => { setFolderPickerTarget("input"); setFolderPickerOpen(true); }}
                          style={{ cursor: "pointer" }}
                        >
                          <FolderOpenOutlined style={{ fontSize: 32, color: "#faad14" }} />
                          <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>选择文件夹</div>
                          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>批量处理文件夹内文件</div>
                        </div>
                      </div>
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setShowTextInput(!showTextInput)}
                        style={{ marginTop: 8 }}
                      >
                        {showTextInput ? "收起文本输入" : "或直接粘贴文本"}
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "var(--ant-color-text-secondary)" }}>
                          已选 {selectedFiles.length} 个文件：
                        </span>
                        <Button size="small" type="link" danger onClick={() => setSelectedFiles([])}>
                          清空
                        </Button>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {selectedFiles.map((f, idx) => (
                          <div key={idx} style={{
                            display: "flex", alignItems: "center", gap: 8,
                            padding: "6px 10px", borderRadius: 6,
                            background: "var(--ant-color-fill-quaternary)",
                          }}>
                            <FileTextOutlined style={{ color: "var(--ant-color-primary)" }} />
                            <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {f.name}
                            </span>
                            {f.size && (
                              <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
                                {(f.size / 1024).toFixed(0)}KB
                              </span>
                            )}
                            <Button
                              size="small" type="text" danger
                              icon={<DeleteOutlined />}
                              onClick={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== idx))}
                            />
                          </div>
                        ))}
                      </div>
                      <Upload
                        accept={ACCEPTED_FILE_TYPES}
                        showUploadList={false}
                        beforeUpload={(file) => {
                          setSelectedFiles([...selectedFiles, { name: file.name, size: file.size, file }]);
                          return false;
                        }}
                      >
                        <Button size="small" type="dashed" icon={<PlusOutlined />} style={{ marginTop: 8 }}>
                          继续添加文件
                        </Button>
                      </Upload>
                    </div>
                  )}

                  {/* 可折叠的文本输入 */}
                  {showTextInput && (
                    <div style={{ marginTop: 12 }}>
                      <ResizableTextArea
                        defaultHeight={140}
                        placeholder={t("textPlaceholder", "在此粘贴需要脱敏的文本...")}
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                      />
                      {!inputText && (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={handleUseSample}>
                          {t("trySample", "试用示例文本")}
                        </Button>
                      )}
                    </div>
                  )}

                  {/* ===== 输出设置 ===== */}
                  <div style={{ marginTop: 16, padding: "12px 16px", background: "var(--ant-color-fill-quaternary)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <ExportOutlined />
                      输出设置
                    </div>
                    <Radio.Group
                      value={outputMode}
                      onChange={(e) => setOutputMode(e.target.value)}
                      style={{ display: "flex", flexDirection: "column", gap: 6 }}
                    >
                      <Radio value="original">输出到原文件夹（与源文件同目录，自动加 _脱敏 后缀）</Radio>
                      <Radio value="default">输出到默认文件夹（桌面/脱敏结果）</Radio>
                      <Radio value="custom">
                        自定义文件夹
                        {outputMode === "custom" && (
                          <Space style={{ marginLeft: 8 }}>
                            <Input
                              size="small"
                              placeholder="选择输出文件夹..."
                              value={outputPath}
                              onChange={(e) => setOutputPath(e.target.value)}
                              style={{ width: 240 }}
                            />
                            <Button size="small" icon={<FolderOpenOutlined />} onClick={() => { setFolderPickerTarget("output"); setFolderPickerOpen(true); }}>
                              浏览
                            </Button>
                          </Space>
                        )}
                      </Radio>
                    </Radio.Group>
                    <Checkbox
                      checked={keepOriginal}
                      onChange={(e) => setKeepOriginal(e.target.checked)}
                      style={{ marginTop: 8, fontSize: 12 }}
                    >
                      保留原始文件（不覆盖源文件）
                    </Checkbox>
                  </div>

                  <div className={styles.actionBar}>
                    <Space>
                      {(inputText || result || selectedFiles.length > 0) && (
                        <Button icon={<ReloadOutlined />} onClick={() => { setResult(null); setSelectedFiles([]); setInputText(""); }}>
                          {t("clearBtn", "清空")}
                        </Button>
                      )}
                      <Button
                        type="primary"
                        size="large"
                        icon={<EyeInvisibleOutlined />}
                        onClick={handleDesensitize}
                        loading={running}
                        disabled={!inputText.trim() && selectedFiles.length === 0}
                        className={styles.runBtn}
                      >
                        {running ? t("processing", "正在处理...") : t("runBtn", "开始脱敏")}
                      </Button>
                    </Space>
                    {inputText.length > 0 && (
                      <span className={styles.charCount}>
                        {inputText.length.toLocaleString()} {t("charsUnit", "字")}
                      </span>
                    )}
                    {selectedFiles.length > 0 && (
                      <span className={styles.charCount}>
                        {selectedFiles.length} 个文件
                      </span>
                    )}
                  </div>
                </div>

                {result && (
                  <div className={styles.resultSection}>
                    <Divider />
                    <div className={styles.resultHeader}>
                      <div className={styles.resultTitleRow}>
                        <SafetyCertificateOutlined className={styles.resultIcon} />
                        <span className={styles.resultTitle}>{t("resultTitle", "脱敏结果")}</span>
                        <Tag color="success">{t("replacedCount", "已替换 {{count}} 处", { count: result.replacements })}</Tag>
                      </div>
                      <Space>
                        <Button size="small" icon={<ExportOutlined />} onClick={handleExportResult}>
                          {t("exportBtn", "导出")}
                        </Button>
                        <Button size="small" icon={<DatabaseOutlined />} onClick={handleSendToWiki}>
                          {t("sendToWikiBtn", "发送至Wiki")}
                        </Button>
                        <Button
                          size="small"
                          icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
                          onClick={handleCopyResult}
                        >
                          {copied ? t("copiedBtn", "已复制") : t("copyBtn", "复制")}
                        </Button>
                      </Space>
                    </div>

                    <pre className={styles.resultText}>{result.desensitized_text}</pre>

                    {Object.keys(result.backfill_map).length > 0 && (
                      <details className={styles.mappingDetails}>
                        <summary className={styles.mappingSummary}>
                          <SwapOutlined /> {t("mappingToggle", "替换对照表（含原始敏感信息）")}
                          <Badge count={Object.keys(result.backfill_map).length} style={{ marginLeft: 8 }} />
                        </summary>
                        <div className={styles.mappingBody}>
                          <Alert
                            type="warning"
                            showIcon
                            icon={<WarningOutlined />}
                            message={t("mappingWarn", "下表包含原始敏感信息，请妥善保管，勿转发给无关人员")}
                            style={{ marginBottom: 12 }}
                          />
                          <div className={styles.mappingGrid}>
                            {Object.entries(result.backfill_map).map(([placeholder, original]) => (
                              <div key={placeholder} className={styles.mappingItem}>
                                <Tag color="orange" className={styles.mappingPlaceholder}>{placeholder}</Tag>
                                <ArrowRightOutlined className={styles.mappingArrow} />
                                <code className={styles.mappingOriginal}>{original}</code>
                              </div>
                            ))}
                          </div>
                        </div>
                      </details>
                    )}
                  </div>
                )}

                <div className={styles.quickActions}>
                  <Divider />
                  <div className={styles.quickActionsGrid}>
                    <div className={styles.quickActionCard} onClick={() => setRulesDrawerOpen(true)}>
                      <SettingOutlined className={styles.quickActionIcon} />
                      <div>
                        <div className={styles.quickActionTitle}>{t("quickRuleSettings", "规则设置")}</div>
                        <div className={styles.quickActionDesc}>{t("quickRuleDesc", "{{count}} 条规则已启用", { count: allRules.filter((r) => r.enabled).length })}</div>
                      </div>
                    </div>

                    <div className={styles.quickActionCard} onClick={() => setActiveTab("tasks")}>
                      <HistoryOutlined className={styles.quickActionIcon} />
                      <div>
                        <div className={styles.quickActionTitle}>{t("quickTaskHistory", "任务历史")}</div>
                        <div className={styles.quickActionDesc}>{t("quickTaskDesc", "共 {{count}} 条记录", { count: taskList.length })}</div>
                      </div>
                    </div>

                    <div className={styles.quickActionCard}>
                      <FolderOpenOutlined className={styles.quickActionIcon} />
                      <div style={{ flex: 1 }}>
                        <div className={styles.quickActionTitle}>{t("quickFolderScan", "文件夹扫描")}</div>
                        <div className={styles.quickActionDesc}>
                          <FolderPicker
                            value={scanFolder}
                            onChange={(v) => setScanFolder(v)}
                            placeholder={t("selectFolderPlaceholder", "选择要扫描的文件夹")}
                            style={{ maxWidth: 280 }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={styles.helpSection}>
                  <Divider dashed />
                  <div className={styles.helpGrid}>
                    <div className={styles.helpItem}>
                      <SafetyCertificateOutlined className={styles.helpIcon} />
                      <div>
                        <strong>{t("helpSecureTitle", "数据安全吗？")}</strong>
                        <p>{t("helpSecureDesc", "标准模式完全在本地运行，不联网不外传数据。智能增强和深度分析模式涉及AI调用——若使用本地部署的模型（如Ollama、vLLM），数据不出内网；若使用第三方云服务，请查阅服务商隐私政策，关注传输加密和数据训练条款。")}</p>
                      </div>
                    </div>
                    <div className={styles.helpItem}>
                      <SettingOutlined className={styles.helpIcon} />
                      <div>
                        <strong>{t("helpRuleTitle", "能自定义规则吗？")}</strong>
                        <p>{t("helpRuleDesc", "可以。点击上方「规则设置」，可启用/禁用内置规则，也可添加自定义正则表达式规则。系统预置了18类常见敏感信息识别规则，覆盖仲裁文书中的典型场景。")}</p>
                      </div>
                    </div>
                    <div className={styles.helpItem}>
                      <SwapOutlined className={styles.helpIcon} />
                      <div>
                        <strong>{t("helpRestoreTitle", "能还原原文吗？")}</strong>
                        <p>{t("helpRestoreDesc", "可以。每次脱敏生成加密对照表，授权人员可在系统中查看并还原原始内容。导出时也可选择是否携带对照表。")}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 文件夹选择弹窗 */}
                <Modal
                  title={folderPickerTarget === "input" ? "选择文件夹" : "选择输出文件夹"}
                  open={folderPickerOpen}
                  onCancel={() => setFolderPickerOpen(false)}
                  onOk={() => {
                    if (folderPickerTarget === "output") {
                      // 输出路径选择
                      if (scanFolder) {
                        setOutputPath(scanFolder);
                        setOutputMode("custom");
                      }
                    } else {
                      // 输入文件夹选择 - 扫描文件夹中的文件
                      if (scanFolder) {
                        message.info(`已选择文件夹：${scanFolder}，正在扫描文件...`);
                        // 这里可以调用扫描API，暂时用模拟
                      }
                    }
                    setFolderPickerOpen(false);
                  }}
                  okText="确认"
                  cancelText="取消"
                >
                  <FolderPicker
                    value={scanFolder}
                    onChange={setScanFolder}
                    placeholder="点击选择本地文件夹..."
                  />
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={folderPickerTarget === "input"
                      ? "选择文件夹后，系统将扫描其中的支持文件（PDF、Word、TXT等），批量进行脱敏处理"
                      : "脱敏结果文件将保存到您选择的文件夹中"
                    }
                  />
                </Modal>
              </div>
            ),
          },
          {
            key: "tasks",
            label: (
              <span>
                <HistoryOutlined />
                {t("tabTasks", "任务列表")}
                {taskList.length > 0 && <Badge count={taskList.length} style={{ marginLeft: 6 }} />}
              </span>
            ),
            children: (
              <div className={styles.tabContent}>
                <div className={styles.tasksHeader}>
                  <Space>
                    <Button
                      icon={<ExportOutlined />}
                      disabled={taskList.length === 0}
                    >
                      {t("exportTasksBtn", "批量导出")}
                    </Button>
                    <Popconfirm
                      title={t("clearTasksConfirm", "确定清空所有历史记录吗？")}
                      onConfirm={() => { setTaskList([]); localStorage.removeItem("desensitize_task_history"); message.success(t("tasksCleared", "已清空")); }}
                    >
                      <Button icon={<DeleteOutlined />} disabled={taskList.length === 0} danger>
                        {t("clearTasksBtn", "清空记录")}
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
                {taskList.length === 0 ? (
                  <Empty description={t("noTasks", "暂无脱敏任务记录")} />
                ) : (
                  <Table
                    dataSource={taskList}
                    columns={taskColumns}
                    rowKey="id"
                    pagination={{ pageSize: 10 }}
                    size="middle"
                  />
                )}
              </div>
            ),
          },
          {
            key: "settings",
            label: (
              <span><SettingOutlined /> {t("tabSettings", "规则设置")}</span>
            ),
            children: (
              <div className={styles.tabContent}>
                <div className={styles.settingsHeader}>
                  <Alert
                    type="info"
                    showIcon
                    message={t(
                      "rulesInfo",
                      "系统预置了18类敏感信息识别规则，涵盖仲裁文书中常见的个人信息、金融信息、案件标识等。您可以按需启用/禁用规则。",
                    )}
                    style={{ marginBottom: 16 }}
                  />
                  <Space>
                    <Button icon={<PlusOutlined />} type="primary">
                      {t("addCustomRule", "添加自定义规则")}
                    </Button>
                    <Popconfirm
                      title={t("resetRulesConfirm", "确定恢复所有默认规则吗？自定义规则将被清除。")}
                      onConfirm={handleResetRules}
                    >
                      <Button icon={<ReloadOutlined />}>{t("resetRulesBtn", "恢复默认")}</Button>
                    </Popconfirm>
                  </Space>
                </div>

                {rulesLoading ? (
                  <div style={{ textAlign: "center", padding: 60 }}><Spin /></div>
                ) : (
                  <>
                    <Table
                      dataSource={allRules}
                      columns={ruleColumns}
                      rowKey="name"
                      pagination={false}
                      size="middle"
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={2}>
                            <Text strong>
                              {t("totalRules", "共 {{total}} 条规则，{{enabled}} 条已启用", {
                                total: allRules.length,
                                enabled: allRules.filter((r) => r.enabled).length,
                              })}
                            </Text>
                          </Table.Summary.Cell>
                          <Table.Summary.Cell index={2} colSpan={2} />
                        </Table.Summary.Row>
                      )}
                    />

                    <div className={styles.ruleCategories}>
                      <h4>{t("ruleCategories", "规则分类说明")}</h4>
                      <div className={styles.categoryTags}>
                        {Array.from(new Set(Object.values(RULE_LABELS).map((r) => r.category))).map((cat) => (
                          <Tag key={cat} color="processing">{cat}</Tag>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            ),
          },
          {
            key: "ocr",
            label: (
              <span><EyeOutlined /> {t("tabOcr", "OCR 工具")}</span>
            ),
            children: (
              <div className={styles.tabContent}>
                <div className={styles.ocrPageLayout}>
                  <div className={styles.ocrLeftCol}>
                    <div className={styles.ocrSection}>
                      <div className={styles.sectionHeader} style={{ marginBottom: 12 }}>
                        <EyeOutlined />
                        <span className={styles.sectionTitle}>{t("ocrConfigTitle", "OCR 配置")}</span>
                      </div>

                      <Alert
                        type="info"
                        showIcon
                        message={t(
                          "ocrConfigInfo",
                          "扫描版PDF和图片需要OCR才能提取文字。支持云端OCR（MinerU）和本地OCR（PaddleOCR）两种方式。",
                        )}
                        style={{ marginBottom: 12 }}
                      />

                      <div className={styles.ocrConfigGrid}>
                        <div className={styles.ocrConfigCard}>
                          <div className={styles.ocrCardHeader}>
                            <CloudOutlined style={{ color: "#1677ff" }} />
                            <span className={styles.ocrCardTitle}>{t("cloudOcrTitle", "云端 OCR（MinerU）")}</span>
                            {parserConfig?.mineru_configured ? (
                              <Tag color="green">{t("configured", "已配置")}</Tag>
                            ) : (
                              <Tag color="default">{t("notConfigured", "未配置")}</Tag>
                            )}
                          </div>
                          <div className={styles.ocrCardBody}>
                            <div className={styles.ocrField}>
                              <label>{t("mineruApiKey", "API 密钥")}</label>
                              <Input.Password
                                placeholder={t("mineruApiKeyPlaceholder", "输入 MinerU API Key")}
                                defaultValue=""
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v) handleSaveParserConfig({ mineru_api_key: v });
                                }}
                              />
                            </div>
                            <div className={styles.ocrField}>
                              <label>{t("mineruBaseUrl", "API 地址")}</label>
                              <Input
                                placeholder="https://mineru.net/api/v4"
                                defaultValue={parserConfig?.mineru_base_url || "https://mineru.net/api/v4"}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v) handleSaveParserConfig({ mineru_base_url: v });
                                }}
                              />
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {t("cloudOcrNote", "数据将发送至MinerU云端处理，请阅读其隐私政策。")}
                            </Text>
                          </div>
                        </div>

                        <div className={styles.ocrConfigCard}>
                          <div className={styles.ocrCardHeader}>
                            <SafetyCertificateOutlined style={{ color: "#52c41a" }} />
                            <span className={styles.ocrCardTitle}>{t("localOcrTitle", "本地 OCR（PaddleOCR）")}</span>
                            <Tag color="green">{t("dataLocal", "数据不出本机")}</Tag>
                            {parserConfig?.paddleocr_installed?.installed && (
                              <Tag color="success" style={{ marginLeft: 0, fontSize: 11 }}>
                                v{parserConfig.paddleocr_installed.version || "?"}
                              </Tag>
                            )}
                          </div>
                          <div className={styles.ocrCardBody}>
                            <div className={styles.ocrInlineControls}>
                              <Space size={8}>
                                <Switch
                                  checked={parserConfig?.local_ocr_enabled ?? true}
                                  loading={parserSaving}
                                  disabled={!parserConfig?.paddleocr_installed?.installed}
                                  onChange={(v) => handleSaveParserConfig({ local_ocr_enabled: v })}
                                />
                                <span style={{ fontSize: 13, fontWeight: 500 }}>
                                  {t("localOcrEnabled", "启用")}
                                </span>
                              </Space>
                              <Space size={8}>
                                <span style={{ fontSize: 13 }}>{t("localOcrLang", "语言")}</span>
                                <Select
                                  value={parserConfig?.local_ocr_lang || "ch"}
                                  style={{ width: 140 }}
                                  size="small"
                                  disabled={!parserConfig?.paddleocr_installed?.installed}
                                  onChange={(v) => handleSaveParserConfig({ local_ocr_lang: v })}
                                  options={[
                                    { value: "ch", label: "中文" },
                                    { value: "en", label: "English" },
                                    { value: "ch_en", label: "中文+English" },
                                    { value: "japan", label: "日本語" },
                                    { value: "korean", label: "한국어" },
                                  ]}
                                />
                              </Space>
                              {!parserConfig?.paddleocr_installed?.installed && (
                                <Tooltip title="请先安装 PaddleOCR，见下方安装引导">
                                  <Tag color="warning" icon={<WarningOutlined />} style={{ cursor: "help" }}>
                                    未安装
                                  </Tag>
                                </Tooltip>
                              )}
                              <Button
                                size="small"
                                type="text"
                                icon={<ReloadOutlined />}
                                onClick={refreshOcrStatus}
                                loading={ocrStatusLoading}
                                style={{ marginLeft: "auto", fontSize: 12 }}
                              >
                                检测
                              </Button>
                            </div>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {parserConfig?.paddleocr_installed?.installed
                                ? t("localOcrNoteOk", "PaddleOCR 已就绪，所有数据在本地处理，不会上传。")
                                : t("localOcrNote", "需要安装 paddleocr 和 paddlepaddle 包。所有数据在本地处理，不会上传。")
                              }
                            </Text>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={styles.ocrSection}>
                      <div className={styles.sectionHeader} style={{ marginBottom: 12 }}>
                        <QuestionCircleOutlined />
                        <span className={styles.sectionTitle}>{t("paddleocrInstallTitle", "PaddleOCR 安装")}</span>
                      </div>

                      {parserConfig?.paddleocr_installed?.installed ? (
                        <Alert
                          type="success"
                          showIcon
                          message={t("paddleocrInstalled", "PaddleOCR 已安装")}
                          description={t("paddleocrInstalledDesc", "当前版本：{{version}}，本地 OCR 功能可正常使用。", { version: parserConfig.paddleocr_installed.version || "未知" })}
                          action={
                            <Button size="small" icon={<ReloadOutlined />} onClick={refreshOcrStatus} loading={ocrStatusLoading}>
                              重新检测
                            </Button>
                          }
                        />
                      ) : (
                        <div>
                          <Alert
                            type="warning"
                            showIcon
                            message="PaddleOCR 尚未安装"
                            description={
                              <span>
                                点击下方按钮一键安装，无需手动操作终端。
                                {isCNUser && <Tag color="blue" style={{ marginLeft: 4 }}>国内镜像已启用</Tag>}
                              </span>
                            }
                            style={{ marginBottom: 12 }}
                          />

                          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
                            <Button
                              type="primary"
                              size="large"
                              icon={<DownloadOutlined />}
                              loading={paddleInstalling}
                              onClick={handleInstallPaddleOCR}
                            >
                              {paddleInstalling ? "正在安装..." : "一键安装 PaddleOCR"}
                            </Button>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {isCNUser
                                ? "使用清华镜像源加速下载"
                                : "使用 PyPI 官方源"
                              }
                              {" · 约 200MB · 预计 2-5 分钟"}
                              {isMac && <Tag color="blue" style={{ marginLeft: 4, fontSize: 11 }}>macOS</Tag>}
                            </Text>
                          </div>

                          {/* 安装进度/日志 */}
                          {paddleInstalling && (
                            <div style={{
                              padding: 12,
                              background: "#0d1117",
                              borderRadius: 8,
                              color: "#58a6ff",
                              fontSize: 12,
                              fontFamily: "monospace",
                              maxHeight: 200,
                              overflow: "auto",
                              marginBottom: 12,
                            }}>
                              <div style={{ color: "#7ee787" }}>▶ 正在安装 paddleocr paddlepaddle...</div>
                              <div style={{ color: "#8b949e", marginTop: 4 }}>请耐心等待，安装期间请勿关闭页面</div>
                              <Spin size="small" style={{ marginTop: 8, color: "#58a6ff" }} />
                            </div>
                          )}

                          {paddleInstallLog && !paddleInstalling && (
                            <div style={{
                              padding: 12,
                              background: "#0d1117",
                              borderRadius: 8,
                              color: paddleInstallResult?.success ? "#7ee787" : "#f85149",
                              fontSize: 12,
                              fontFamily: "monospace",
                              maxHeight: 300,
                              overflow: "auto",
                              marginBottom: 12,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-all",
                            }}>
                              <div style={{ fontWeight: "bold", marginBottom: 4 }}>
                                {paddleInstallResult?.success ? "✅ 安装成功" : "❌ 安装失败"}
                              </div>
                              {paddleInstallLog}
                            </div>
                          )}

                          {paddleInstallResult && !paddleInstallResult.success && (
                            <Alert
                              type="error"
                              showIcon
                              message="安装失败"
                              description={
                                <div>
                                  <p style={{ marginBottom: 4 }}>{paddleInstallResult.message}</p>
                                  {paddleInstallResult.is_arm_mac && (
                                    <Alert
                                      type="info"
                                      showIcon
                                      message="Apple Silicon 提示"
                                      description="M系列芯片 Mac 上 PaddlePaddle 可能需要 Rosetta 环境运行 Python，建议使用 conda 安装：conda install paddlepaddle"
                                      style={{ marginBottom: 8, fontSize: 12 }}
                                    />
                                  )}
                                  <p style={{ marginBottom: 4, fontSize: 12 }}>
                                    可以尝试手动安装：打开终端（{isMac ? "Mac: 启动台 → 其他 → 终端" : "Windows: Win+R → cmd"}），执行以下命令：
                                  </p>
                                  <div className={styles.codeBlock}>
                                    <code>{pipCmd}</code>
                                    <Tooltip title="复制">
                                      <CopyOutlined
                                        className={styles.copyBtn}
                                        onClick={() => {
                                          navigator.clipboard.writeText(pipCmd);
                                          message.success("已复制");
                                        }}
                                      />
                                    </Tooltip>
                                  </div>
                                </div>
                              }
                              style={{ marginBottom: 12 }}
                            />
                          )}

                          <Collapse
                            size="small"
                            ghost
                            items={[{
                              key: "manual",
                              label: <Text type="secondary" style={{ fontSize: 12 }}>手动安装步骤（高级用户）</Text>,
                              children: (
                                <div style={{ fontSize: 12 }}>
                                  <p>1. 打开终端（{isMac ? "Mac: 启动台 → 其他 → 终端，或 Spotlight 搜索 Terminal" : "Windows: Win+R → 输入 cmd → 回车"}）</p>
                                  <div className={styles.codeBlock} style={{ marginBottom: 8 }}>
                                    <code>{pipCmd}</code>
                                    <CopyOutlined className={styles.copyBtn} onClick={() => {
                                      navigator.clipboard.writeText(pipCmd);
                                      message.success("已复制");
                                    }} />
                                  </div>
                                  {!isMac && (
                                    <p>2. 如有 NVIDIA 显卡，可安装 GPU 版本加速：将 paddlepaddle 替换为 paddlepaddle-gpu</p>
                                  )}
                                  {isMac && (
                                    <p>2. Apple Silicon (M系列) Mac 如安装失败，可尝试使用 conda：conda install paddlepaddle</p>
                                  )}
                                  <p>{isMac ? "3" : "3"}. 安装后点击下方按钮验证：</p>
                                  <Button size="small" icon={<CheckCircleOutlined />} loading={ocrStatusLoading} onClick={refreshOcrStatus}>
                                    检查安装状态
                                  </Button>
                                </div>
                              ),
                            }]}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={styles.ocrRightCol}>
                    <div className={styles.ocrSection}>
                      <div className={styles.sectionHeader} style={{ marginBottom: 12 }}>
                        <FileSearchOutlined />
                        <span className={styles.sectionTitle}>{t("ocrToolTitle", "OCR 文字识别")}</span>
                      </div>

                      <Alert
                        type="info"
                        showIcon
                        message={t("ocrToolInfo", "上传图片或扫描版 PDF，提取文字内容。可选择本地或云端引擎。")}
                        style={{ marginBottom: 12 }}
                      />

                      <div style={{ marginBottom: 12 }}>
                        <Text type="secondary" style={{ fontSize: 12, display: "block", marginBottom: 4 }}>
                          {t("ocrEngineLabel", "识别引擎")}
                        </Text>
                        <Select
                          value={ocrEngine}
                          onChange={setOcrEngine}
                          style={{ width: "100%" }}
                          options={[
                            { value: "auto", label: t("ocrEngineAuto", "自动（优先云端，失败回退本地）") },
                            { value: "cloud_ocr", label: "☁️ MinerU 云端 OCR" },
                            { value: "local_only", label: "🛡️ PaddleOCR 本地 OCR" },
                          ]}
                        />
                        <div style={{ marginTop: 4, fontSize: 11, color: "var(--ant-color-text-tertiary)" }}>
                          {ocrEngine === "auto" && "先尝试 MinerU 云端 OCR，失败后自动回退到本地 PaddleOCR"}
                          {ocrEngine === "cloud_ocr" && "数据将上传至 MinerU 云端处理，需要配置 API Key"}
                          {ocrEngine === "local_only" && "数据完全在本地处理，需要安装 PaddleOCR"}
                        </div>
                      </div>

                      {/* 引擎状态指示器 */}
                      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                        <Tag
                          color={parserConfig?.paddleocr_installed?.installed ? "success" : "default"}
                          icon={<SafetyCertificateOutlined />}
                          style={{ fontSize: 11 }}
                        >
                          PaddleOCR {parserConfig?.paddleocr_installed?.installed ? `v${parserConfig.paddleocr_installed.version}` : "未安装"}
                        </Tag>
                        <Tag
                          color={parserConfig?.mineru_configured ? "success" : "default"}
                          icon={<CloudOutlined />}
                          style={{ fontSize: 11 }}
                        >
                          MinerU {parserConfig?.mineru_configured ? "已配置" : "未配置"}
                        </Tag>
                      </div>

                      <Upload
                        accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.bmp,.webp"
                        showUploadList={false}
                        customRequest={handleOcrTry}
                        disabled={ocrTryLoading}
                      >
                        <Button
                          icon={<UploadOutlined />}
                          loading={ocrTryLoading}
                          type="primary"
                          block
                          size="large"
                        >
                          {ocrTryLoading
                            ? t("ocrTryProcessing", "正在识别...")
                            : t("ocrTryUpload", "上传图片/PDF 进行 OCR")}
                        </Button>
                      </Upload>

                      {ocrTryResult !== null && (
                        <div className={styles.ocrTryResult}>
                          <div className={styles.ocrTryResultHeader}>
                            <span>{t("ocrTryResult", "识别结果")}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              {ocrTryEngine && (
                                <Tag
                                  color={ocrTryEngine === "cloud_ocr" ? "blue" : ocrTryEngine === "local_only" ? "green" : "default"}
                                  icon={ocrTryEngine === "cloud_ocr" ? <CloudOutlined /> : ocrTryEngine === "local_only" ? <SafetyCertificateOutlined /> : undefined}
                                >
                                  {ocrTryEngine === "cloud_ocr" ? "MinerU 云端" : ocrTryEngine === "local_only" ? "PaddleOCR 本地" : "自动"}
                                </Tag>
                              )}
                              <Button
                                size="small"
                                type="link"
                                icon={<CopyOutlined />}
                                onClick={() => {
                                  navigator.clipboard.writeText(ocrTryResult);
                                  message.success(t("copied", "已复制"));
                                }}
                              >
                                {t("copy", "复制")}
                              </Button>
                            </div>
                          </div>
                          {ocrTryError && (
                            <Alert type="warning" message={ocrTryError} style={{ margin: "8px 12px" }} />
                          )}
                          <div className={styles.ocrTryResultContent}>
                            {ocrTryResult || <Text type="secondary">{t("ocrTryNoResult", "未能识别到文字内容")}</Text>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />

      <Drawer
        title={t("rulesDrawerTitle", "脱敏规则管理")}
        open={rulesDrawerOpen}
        onClose={() => setRulesDrawerOpen(false)}
        width={720}
      >
        {allRules.map((rule, idx) => {
          const info = RULE_LABELS[rule.name];
          return (
            <div key={rule.name} className={styles.drawerRuleItem}>
              <Switch
                checked={rule.enabled}
                onChange={() => handleToggleRule(idx)}
              />
              <div className={styles.drawerRuleInfo}>
                <div>
                  <strong>{info ? t(info.labelKey, rule.name) : rule.name}</strong>
                  {info && <Tag color={info.color} style={{ marginLeft: 8, fontSize: 11 }}>{info.category}</Tag>}
                </div>
                <code className={styles.drawerRulePattern}>{rule.pattern}</code>
              </div>
              <Tag color="blue">{rule.placeholder.replace("{seq:03d}", "XXX")}</Tag>
            </div>
          );
        })}
      </Drawer>

      {/* 任务详情查看弹窗 */}
      <Modal
        title={viewingTask ? `脱敏结果 - ${viewingTask.name}` : ""}
        open={!!viewingTask}
        onCancel={() => setViewingTask(null)}
        footer={[
          <Button key="close" onClick={() => setViewingTask(null)}>关闭</Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={() => {
              if (viewingTask?.result?.desensitized_text) {
                navigator.clipboard.writeText(viewingTask.result.desensitized_text);
                message.success("已复制到剪贴板");
              }
            }}
          >
            复制结果
          </Button>,
          <Button
            key="export"
            icon={<DownloadOutlined />}
            onClick={() => {
              if (viewingTask?.result?.desensitized_text) {
                const blob = new Blob([viewingTask.result.desensitized_text], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${viewingTask.name}_脱敏结果.txt`;
                a.click();
                URL.revokeObjectURL(url);
                message.success("已导出");
              }
            }}
          >
            导出 TXT
          </Button>,
        ]}
        width={800}
        styles={{ body: { maxHeight: "70vh", overflow: "auto" } }}
      >
        {viewingTask?.result && (
          <Tabs
            size="small"
            items={[
              {
                key: "result",
                label: "脱敏结果",
                children: (
                  <div>
                    <div style={{ marginBottom: 8, display: "flex", gap: 8, alignItems: "center" }}>
                      <Tag color="green">{viewingTask.mode}</Tag>
                      <Tag>{viewingTask.replacements} 处替换</Tag>
                      <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>{viewingTask.createdAt}</span>
                    </div>
                    <Input.TextArea
                      value={viewingTask.result.desensitized_text}
                      readOnly
                      autoSize={{ minRows: 10, maxRows: 25 }}
                      style={{ background: "var(--ant-color-fill-quaternary)" }}
                    />
                  </div>
                ),
              },
              {
                key: "map",
                label: "替换对照表",
                children: (
                  <Table
                    dataSource={
                      viewingTask.result.backfill_map
                        ? Object.entries(viewingTask.result.backfill_map).map(([placeholder, original], idx) => ({
                            key: idx,
                            placeholder,
                            original: original as string,
                          }))
                        : []
                    }
                    columns={[
                      { title: "脱敏占位符", dataIndex: "placeholder", key: "placeholder" },
                      { title: "原始内容", dataIndex: "original", key: "original" },
                    ]}
                    pagination={false}
                    size="small"
                    scroll={{ y: 400 }}
                  />
                ),
              },
            ]}
          />
        )}
      </Modal>
    </div>
  );
}