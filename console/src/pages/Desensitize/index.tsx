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
  FileTextOutlined,
  FileMarkdownOutlined,
  CodeOutlined,
  DesktopOutlined,
  CloudServerOutlined,
  ApiOutlined,
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
  Progress,
} from "antd";
import { PageHeader } from "@/components/PageHeader";
import { knowledgeApi } from "@/api/modules/knowledge";
import { getApiUrl } from "@/api/config";
import FolderPicker from "@/components/FolderPicker";
import { ResizableTextArea } from "@/components/ResizableTextArea";
import styles from "./index.module.less";

const { Text, Paragraph } = Typography;

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

function DesensitizePage() {
  const { t: _t } = useTranslation();
  const t = (key: string, fallbackOrOptions?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
    if (typeof fallbackOrOptions === "string") {
      return _t(`desensitize.${key}`, fallbackOrOptions, options);
    }
    return _t(`desensitize.${key}`, fallbackOrOptions);
  };
  const [activeTab, setActiveTab] = useState("desensitize");
  const [desensSubTab, setDesensSubTab] = useState("workspace");
  const [parseSubTab, setParseSubTab] = useState("parse");
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

  // 文档解析工作区
  const [parseFile, setParseFile] = useState<File | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<string | null>(null);
  const [parseFormat, setParseFormat] = useState<"markdown" | "html" | "json" | "text">("markdown");
  const [parseEngine, setParseEngine] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");

  const [rulesDrawerOpen, setRulesDrawerOpen] = useState(false);
  const [allRules, setAllRules] = useState<RuleItem[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);

  const [scanFolder, setScanFolder] = useState("");
  const [scanning, setScanning] = useState(false);
  const [, setScannedFiles] = useState<any[]>([]);

  const [taskList, setTaskList] = useState<any[]>([]);
  const [viewingTask, setViewingTask] = useState<any | null>(null);

  const [parserConfig, setParserConfig] = useState<{
    default_mode: string;
    mineru_api_key: string;
    mineru_base_url: string;
    mineru_mode: string;
    mineru_backend: string;
    mineru_effort: string;
    mineru_configured: boolean;
  } | null>(null);
  const [, setParserSaving] = useState(false);
  const [ocrStatusLoading, setOcrStatusLoading] = useState(false);
  const [localMineruStatus, setLocalMineruStatus] = useState<{ reachable: boolean; error?: string } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [, setDeployResult] = useState<{
    success: boolean;
    method?: string;
    stage?: string;
    error?: string;
    output?: string;
    message?: string;
  } | null>(null);
  const [deployProgress, setDeployProgress] = useState<{
    task_id: string;
    status: string;
    stage: string;
    progress: number;
    message: string;
    error: string;
  } | null>(null);
  const [precheckResult, setPrecheckResult] = useState<{
    can_deploy: boolean;
    checks: Record<string, any>;
    warnings: string[];
    blockers: string[];
  } | null>(null);
  const [prechecking, setPrechecking] = useState(false);
  const isCNUser = useMemo(() => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
      return tz.includes("Shanghai") || tz.includes("Chongqing") || tz.includes("Urumqi") || tz.includes("Harbin") || tz.includes("Hong_Kong") || tz.includes("Taipei") || tz.includes("Asia/Ulaanbaatar");
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    knowledgeApi.getParserConfig().then(setParserConfig).catch(() => {});
  }, []);

  const refreshOcrStatus = async () => {
    setOcrStatusLoading(true);
    try {
      const res = await knowledgeApi.getOcrStatus();
      setParserConfig((prev) => prev ? { ...prev, mineru_configured: res.mineru_configured, mineru_mode: res.mineru_mode, mineru_base_url: res.mineru_base_url } : prev);
      setLocalMineruStatus(res.local_mineru || null);
    } catch {
      message.error(t("ocrStatusError", "检查失败"));
    } finally {
      setOcrStatusLoading(false);
    }
  };

  const handleSaveParserConfig = async (updates: Record<string, unknown>) => {
    setParserSaving(true);
    try {
      const res = await knowledgeApi.updateParserConfig(updates);
      setParserConfig(res);
      message.success(t("parserConfigSaved", "文档引擎配置已保存"));
    } catch {
      message.error(t("parserConfigError", "保存失败"));
    } finally {
      setParserSaving(false);
    }
  };

  const handleDeployMineru = async () => {
    setDeploying(true);
    setDeployResult(null);
    setDeployProgress(null);
    try {
      const res = await knowledgeApi.deployLocalMineru({
        use_mirror: isCNUser,
        mirror_url: isCNUser ? "https://pypi.tuna.tsinghua.edu.cn/simple" : undefined,
      });

      if (res.task_id) {
        const ssePath = knowledgeApi.getDeployProgressSSEUrl(res.task_id);
        const fullUrl = getApiUrl(ssePath);

        const evtSource = new EventSource(fullUrl);

        evtSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setDeployProgress(data);

            if (data.status === "completed") {
              evtSource.close();
              setDeploying(false);
              const successMsg = data.message || "本地文档引擎部署成功！";
              setDeployResult({
                success: true,
                stage: data.stage,
                message: successMsg,
              });
              message.success(successMsg);
              refreshOcrStatus();
              knowledgeApi.getParserConfig().then(setParserConfig).catch(() => {});
            } else if (data.status === "failed") {
              evtSource.close();
              setDeploying(false);
              const failMsg = data.error || "部署失败";
              setDeployResult({
                success: false,
                stage: data.stage,
                error: failMsg,
                output: data.result?.output as string | undefined,
              });
              message.error(failMsg);
            }
          } catch {
            // ignore parse errors
          }
        };

        evtSource.onerror = () => {
          evtSource.close();
          knowledgeApi.getDeployTaskStatus(res.task_id).then((status) => {
            if (status.status === "completed") {
              setDeployResult({ success: true, stage: status.stage, message: status.message });
              message.success(status.message || "部署成功");
            } else if (status.status === "failed") {
              setDeployResult({ success: false, stage: status.stage, error: status.error });
              message.error(status.error || "部署失败");
            } else {
              setDeployResult({
                success: false,
                error: "SSE 连接中断，部署可能仍在后台进行中，请稍后检查服务状态",
              });
              message.warning("连接中断，部署可能仍在进行中");
            }
            setDeploying(false);
          }).catch(() => {
            setDeploying(false);
            setDeployResult({ success: false, error: "无法获取部署状态" });
          });
        };
      } else {
        setDeploying(false);
        setDeployResult({ success: false, error: res.message || "部署任务创建失败" });
        message.error(res.message || "部署请求失败");
      }
    } catch (err: any) {
      setDeploying(false);
      const errorMsg = `请求失败: ${err.message || err}`;
      setDeployResult({ success: false, error: errorMsg });
      message.error("部署请求失败");
    }
  };

  const handlePrecheckMineru = async () => {
    setPrechecking(true);
    setPrecheckResult(null);
    try {
      const res = await knowledgeApi.precheckLocalMineru();
      setPrecheckResult(res);
      if (!res.can_deploy) {
        message.error(`环境检查未通过: ${res.blockers.join("; ")}`);
      } else if (res.warnings.length > 0) {
        message.warning(`环境检查通过，但有警告: ${res.warnings.join("; ")}`);
      } else {
        message.success("环境检查通过，可以开始部署");
      }
    } catch (err: any) {
      message.error(`环境检查失败: ${err.message || err}`);
    } finally {
      setPrechecking(false);
    }
  };

  const handleStopMineru = async () => {
    try {
      await knowledgeApi.stopLocalMineru();
      message.success("本地文档引擎已停止");
      await refreshOcrStatus();
      const cfg = await knowledgeApi.getParserConfig();
      setParserConfig(cfg);
      setLocalMineruStatus(null);
    } catch {
      message.error("停止失败");
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

  const handleParseDocument = async (file: File) => {
    setParseLoading(true);
    setParseResult(null);
    setParseEngine("");
    setParseError("");
    setParseFile(file);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/knowledge/ocr-try", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.error && !data.text) {
        setParseError(data.error);
        setParseResult("");
      } else {
        setParseResult(data.text || "");
        setParseEngine(data.engine || "");
        if (data.error) {
          setParseError(data.error);
        }
      }
    } catch (err: any) {
      setParseError(err.message || "文档解析失败");
      setParseResult("");
    } finally {
      setParseLoading(false);
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
                  <li>{t("sol1", "在「引擎设置」页面配置 API 密钥或部署本地引擎，启用文档识别功能")}</li>
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
      <PageHeader current={t("pageTitle", "文档智能")} />

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className={styles.mainTabs}
        items={[
          {
            key: "desensitize",
            label: (
              <span><SafetyCertificateOutlined /> {t("tabWorkspace", "材料脱敏")}</span>
            ),
            children: (
              <div className={styles.subTabContainer}>
                <Tabs
                  activeKey={desensSubTab}
                  onChange={setDesensSubTab}
                  type="card"
                  size="small"
                  className={styles.subTabs}
                  items={[
                    {
                      key: "workspace",
                      label: <span><EditOutlined /> 工作区</span>,
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
                  {scanning ? (
                    <div className={styles.fileDropZone}>
                      <Spin tip="正在扫描文件夹中的文件..." size="large">
                        <div style={{ minHeight: 100 }} />
                      </Spin>
                    </div>
                  ) : selectedFiles.length === 0 ? (
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
                            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>选择文件</div>
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
                        <Button size="small" type="link" danger onClick={() => { setSelectedFiles([]); setScannedFiles([]); }}>
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
                            <span style={{ flex: 1, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.path || f.name}>
                              {f.name}
                            </span>
                            {f.size != null && (
                              <span style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)", flexShrink: 0 }}>
                                {f.size >= 1048576
                                  ? `${(f.size / 1048576).toFixed(1)}MB`
                                  : `${(f.size / 1024).toFixed(0)}KB`}
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
                  onOk={async () => {
                    if (folderPickerTarget === "output") {
                      // 输出路径选择
                      if (scanFolder) {
                        setOutputPath(scanFolder);
                        setOutputMode("custom");
                      }
                      setFolderPickerOpen(false);
                    } else {
                      // 输入文件夹选择 - 扫描文件夹中的文件
                      if (!scanFolder) {
                        setFolderPickerOpen(false);
                        return;
                      }
                      setFolderPickerOpen(false);
                      setScanning(true);
                      setScannedFiles([]);
                      try {
                        const res = await knowledgeApi.scanFolder(scanFolder);
                        if (res.files && res.files.length > 0) {
                          setScannedFiles(res.files);
                          setSelectedFiles(
                            res.files.map((f: any) => ({
                              name: f.name,
                              size: f.size,
                              path: f.path,
                              type: f.type,
                            })),
                          );
                          message.success(`扫描完成，共找到 ${res.file_count} 个支持的文件`);
                        } else {
                          message.warning("该文件夹中未找到支持的文件（PDF / Word / Excel / TXT 等）");
                        }
                      } catch (err: any) {
                        message.error(err?.message || "扫描文件夹失败，请检查路径是否正确");
                      } finally {
                        setScanning(false);
                      }
                    }
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
                          {t("tabTasks", "脱敏记录")}
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
                      label: <span><SettingOutlined /> {t("tabSettings", "脱敏规则")}</span>,
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
                  ]}
                />
              </div>
            ),
          },
          {
            key: "parse",
            label: (
              <span><FileSearchOutlined /> {t("tabParse", "文档解析")}</span>
            ),
            children: (
              <div className={styles.subTabContainer}>
                <Tabs
                  activeKey={parseSubTab}
                  onChange={setParseSubTab}
                  type="card"
                  size="small"
                  className={styles.subTabs}
                  items={[
                    {
                      key: "parse",
                      label: <span><FileSearchOutlined /> 解析工作区</span>,
                      children: (
                        <div className={styles.parseWorkspace}>
                          <div className={`${styles.parseUploadArea} ${parseFile ? styles.hasFile : ""}`}>
                            {parseFile ? (
                              <div style={{ textAlign: "center" }}>
                                <FileTextOutlined style={{ fontSize: 36, color: "var(--ant-color-success)" }} />
                                <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>{parseFile.name}</div>
                                <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginTop: 4 }}>
                                  {(parseFile.size / 1024).toFixed(0)} KB
                                </div>
                                <Space style={{ marginTop: 12 }}>
                                  <Button type="primary" icon={<FileSearchOutlined />} loading={parseLoading} onClick={() => handleParseDocument(parseFile)}>
                                    {parseLoading ? "解析中..." : "开始解析"}
                                  </Button>
                                  <Button onClick={() => { setParseFile(null); setParseResult(null); setParseError(""); }}>
                                    重新选择
                                  </Button>
                                </Space>
                              </div>
                            ) : (
                              <Upload
                                accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                                showUploadList={false}
                                beforeUpload={(file) => { setParseFile(file); return false; }}
                              >
                                <div style={{ textAlign: "center" }}>
                                  <UploadOutlined style={{ fontSize: 36, color: "var(--ant-color-primary)" }} />
                                  <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>上传文档</div>
                                  <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginTop: 4 }}>
                                    PDF / 图片 / Word / Excel / PPT
                                  </div>
                                </div>
                              </Upload>
                            )}
                          </div>

                          {parseResult !== null && (
                            <>
                              <div className={styles.parseFormatBar}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ant-color-text-secondary)" }}>输出格式：</span>
                                <Radio.Group value={parseFormat} onChange={(e) => setParseFormat(e.target.value)} size="small">
                                  <Radio.Button value="markdown"><FileMarkdownOutlined /> Markdown</Radio.Button>
                                  <Radio.Button value="html"><CodeOutlined /> HTML</Radio.Button>
                                  <Radio.Button value="json"><ApiOutlined /> JSON</Radio.Button>
                                  <Radio.Button value="text"><FileTextOutlined /> 纯文本</Radio.Button>
                                </Radio.Group>
                                <div style={{ marginLeft: "auto" }}>
                                  <Space>
                                    <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(parseResult || ""); message.success("已复制"); }}>
                                      复制
                                    </Button>
                                    <Button size="small" icon={<DownloadOutlined />} onClick={() => {
                                      const ext = parseFormat === "markdown" ? "md" : parseFormat === "html" ? "html" : parseFormat === "json" ? "json" : "txt";
                                      const blob = new Blob([parseResult || ""], { type: "text/plain;charset=utf-8" });
                                      const url = URL.createObjectURL(blob);
                                      const a = document.createElement("a");
                                      a.href = url;
                                      a.download = `${parseFile?.name?.replace(/\.[^.]+$/, "") || "parsed"}.${ext}`;
                                      a.click();
                                      URL.revokeObjectURL(url);
                                    }}>
                                      下载
                                    </Button>
                                  </Space>
                                </div>
                              </div>

                              <div className={styles.parseResultArea}>
                                <div className={styles.parseResultHeader}>
                                  <span>
                                    <CheckCircleOutlined style={{ color: "var(--ant-color-success)", marginRight: 6 }} />
                                    解析结果
                                    {parseEngine && <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>引擎: {parseEngine}</Tag>}
                                  </span>
                                  <span style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)" }}>
                                    {(parseResult || "").length.toLocaleString()} 字符
                                  </span>
                                </div>
                                <div className={styles.parseResultBody}>
                                  {parseResult || <Text type="secondary">无内容</Text>}
                                </div>
                              </div>
                            </>
                          )}

                          {parseError && (
                            <Alert type="warning" showIcon message="解析提示" description={parseError} style={{ marginTop: 16 }} />
                          )}
                        </div>
                      ),
                    },
                    {
                      key: "engine",
                      label: <span><SettingOutlined /> 引擎设置</span>,
                      children: (
                        <div className={styles.engineSettingsCompact}>
                          <div className={styles.engineModeSwitch}>
                            <div
                              className={`${styles.engineModeCard} ${parserConfig?.mineru_mode === "cloud" ? styles.active : ""}`}
                              onClick={() => handleSaveParserConfig({ mineru_mode: "cloud" })}
                            >
                              <div className={styles.engineModeIcon}><CloudServerOutlined style={{ color: "#1677ff" }} /></div>
                              <div className={styles.engineModeTitle}>云端模式</div>
                              <div className={styles.engineModeDesc}>通过 API 调用，无需本地安装</div>
                              {parserConfig?.mineru_configured && parserConfig?.mineru_mode === "cloud" && (
                                <Tag color="green" style={{ marginTop: 6 }}>已配置</Tag>
                              )}
                            </div>
                            <div
                              className={`${styles.engineModeCard} ${parserConfig?.mineru_mode !== "cloud" ? styles.active : ""}`}
                              onClick={() => handleSaveParserConfig({ mineru_mode: "local" })}
                            >
                              <div className={styles.engineModeIcon}><DesktopOutlined style={{ color: "#52c41a" }} /></div>
                              <div className={styles.engineModeTitle}>本地模式</div>
                              <div className={styles.engineModeDesc}>数据不出本机，适合保密文件</div>
                              {localMineruStatus?.reachable && (
                                <Tag color="success" style={{ marginTop: 6 }}>在线</Tag>
                              )}
                            </div>
                          </div>

                          {parserConfig?.mineru_mode === "cloud" ? (
                            <Card size="small" title={<span><CloudOutlined /> 云端 API 配置</span>}>
                              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                                <div>
                                  <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>API 密钥</label>
                                  <Input.Password
                                    placeholder="输入 MinerU API Key"
                                    value={parserConfig?.mineru_api_key || ""}
                                    onChange={(e) => handleSaveParserConfig({ mineru_api_key: e.target.value, mineru_mode: "cloud" })}
                                  />
                                </div>
                                <div>
                                  <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>API 地址</label>
                                  <Input
                                    placeholder="https://mineru.net/api/v4"
                                    value={parserConfig?.mineru_base_url || ""}
                                    onChange={(e) => handleSaveParserConfig({ mineru_base_url: e.target.value })}
                                  />
                                </div>
                                <Collapse ghost size="small" items={[{
                                  key: "help",
                                  label: <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>如何获取密钥？</span>,
                                  children: (
                                    <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                                      <ol style={{ paddingLeft: 16, margin: 0 }}>
                                        <li>访问 <a href="https://mineru.net" target="_blank" rel="noopener noreferrer">mineru.net</a> 注册账号</li>
                                        <li>登录后进入「API 密钥」页面</li>
                                        <li>点击「创建新密钥」，复制生成的 Key</li>
                                        <li>将 Key 粘贴到上方输入框即可自动保存</li>
                                      </ol>
                                      <div style={{ marginTop: 8, padding: "6px 8px", background: "var(--ant-color-fill-quaternary)", borderRadius: 4 }}>
                                        <Text type="secondary" style={{ fontSize: 11 }}>MinerU 提供免费额度，日常使用通常足够。如文档涉及保密要求，建议使用本地部署模式。</Text>
                                      </div>
                                    </div>
                                  ),
                                }]} />
                              </div>
                            </Card>
                          ) : (
                            <Card size="small" title={<span><DesktopOutlined /> 本地引擎管理</span>}>
                              {localMineruStatus?.reachable ? (
                                <div>
                                  <Alert type="success" showIcon message="本地服务运行中" description="所有文档在本机处理，不会上传到任何外部服务器。" style={{ marginBottom: 12 }} />
                                  <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>识别方式</label>
                                      <Select value={parserConfig?.mineru_backend || "pipeline"} size="small" style={{ width: "100%" }} onChange={(v) => handleSaveParserConfig({ mineru_backend: v })} options={[
                                        { value: "pipeline", label: "Pipeline（通用，无需显卡）" },
                                        { value: "hybrid", label: "Hybrid（高精度，需显卡）" },
                                      ]} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>识别精度</label>
                                      <Select value={parserConfig?.mineru_effort || "medium"} size="small" style={{ width: "100%" }} onChange={(v) => handleSaveParserConfig({ mineru_effort: v })} options={[
                                        { value: "medium", label: "Medium（快速）" },
                                        { value: "high", label: "High（最佳）" },
                                      ]} />
                                    </div>
                                  </div>
                                  <Space>
                                    <Button size="small" icon={<ReloadOutlined />} onClick={refreshOcrStatus} loading={ocrStatusLoading}>检测连接</Button>
                                    <Button size="small" danger onClick={handleStopMineru}>停止服务</Button>
                                  </Space>
                                </div>
                              ) : (
                                <div>
                                  <Alert type="info" showIcon message="一键部署本地文档引擎" description="点击按钮即可自动完成安装，无需任何技术操作。部署后所有文档在本机处理，不联网也能使用。" style={{ marginBottom: 12 }} />

                                  <Collapse ghost size="small" style={{ marginBottom: 12 }} items={[{
                                    key: "hw",
                                    label: <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}><DatabaseOutlined style={{ marginRight: 4 }} />硬件要求</span>,
                                    children: (
                                      <div style={{ fontSize: 12 }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                          <thead><tr style={{ borderBottom: "1px solid var(--ant-color-border)" }}>
                                            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ant-color-text-secondary)", fontWeight: 500 }}>组件</th>
                                            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ant-color-text-secondary)", fontWeight: 500 }}>最低</th>
                                            <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ant-color-text-secondary)", fontWeight: 500 }}>推荐</th>
                                          </tr></thead>
                                          <tbody>
                                            <tr><td style={{ padding: "4px 8px" }}>GPU</td><td style={{ padding: "4px 8px" }}><Tag color="orange" style={{ margin: 0, fontSize: 11 }}>8GB 显存</Tag></td><td style={{ padding: "4px 8px" }}><Tag color="green" style={{ margin: 0, fontSize: 11 }}>16GB+</Tag></td></tr>
                                            <tr><td style={{ padding: "4px 8px" }}>CPU</td><td style={{ padding: "4px 8px" }}>4 核</td><td style={{ padding: "4px 8px" }}>8 核+</td></tr>
                                            <tr><td style={{ padding: "4px 8px" }}>内存</td><td style={{ padding: "4px 8px" }}>8 GB</td><td style={{ padding: "4px 8px" }}>16 GB+</td></tr>
                                            <tr><td style={{ padding: "4px 8px" }}>磁盘</td><td style={{ padding: "4px 8px" }}>20 GB</td><td style={{ padding: "4px 8px" }}>50 GB+ (SSD)</td></tr>
                                            <tr><td style={{ padding: "4px 8px" }}>Python</td><td style={{ padding: "4px 8px" }} colSpan={2}>3.10 ~ 3.12</td></tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    ),
                                  }]} />

                                  <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>识别方式</label>
                                      <Select value={parserConfig?.mineru_backend || "pipeline"} size="small" style={{ width: "100%" }} onChange={(v) => handleSaveParserConfig({ mineru_backend: v })} options={[
                                        { value: "pipeline", label: "Pipeline（通用）" },
                                        { value: "hybrid", label: "Hybrid（高精度）" },
                                      ]} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <label style={{ fontSize: 12, color: "var(--ant-color-text-secondary)", marginBottom: 4, display: "block" }}>识别精度</label>
                                      <Select value={parserConfig?.mineru_effort || "medium"} size="small" style={{ width: "100%" }} onChange={(v) => handleSaveParserConfig({ mineru_effort: v })} options={[
                                        { value: "medium", label: "Medium（快速）" },
                                        { value: "high", label: "High（最佳）" },
                                      ]} />
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                                    <Button icon={<WarningOutlined />} loading={prechecking} onClick={handlePrecheckMineru} style={{ flex: 1 }}>{prechecking ? "检测中..." : "环境检测"}</Button>
                                    <Button type="primary" size="large" icon={<DownloadOutlined />} loading={deploying} onClick={handleDeployMineru} style={{ flex: 2 }}>{deploying ? "正在部署..." : "一键部署本地文档引擎"}</Button>
                                  </div>

                                  {precheckResult && (
                                    <div style={{ padding: 12, background: precheckResult.can_deploy ? "#f6ffed" : "#fff2f0", borderRadius: 8, marginBottom: 12, fontSize: 12 }}>
                                      <div style={{ fontWeight: "bold", marginBottom: 6, color: precheckResult.can_deploy ? "#52c41a" : "#ff4d4f" }}>
                                        {precheckResult.can_deploy ? "✅ 环境检查通过" : "❌ 环境检查未通过"}
                                      </div>
                                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                                        {Object.entries(precheckResult.checks).map(([key, val]: [string, any]) => (
                                          <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                            <span style={{ color: val.ok ? "#52c41a" : "#ff4d4f" }}>{val.ok ? "✓" : "✗"}</span>
                                            <span>{key === "python" && `Python ${val.version || ""}`}{key === "gpu" && (val.available ? `${val.best_name || "GPU"} ${val.best_vram_gb ? `(${val.best_vram_gb}GB)` : ""}` : val.note || "无 GPU")}{key === "memory" && (val.total_gb ? `内存 ${val.total_gb}GB` : val.note || "未知")}{key === "disk" && `磁盘 ${val.free_gb ? `${val.free_gb}GB` : ""}`}{key === "network" && `网络 ${val.pypi ? "(PyPI)" : val.mirror ? "(镜像)" : ""}`}{key === "port" && `端口 ${val.port || 8000}`}{key === "venv" && `${val.exists ? "已有环境" : "待创建"}`}{key === "installed" && `${val.installed ? `已安装${val.version ? ` v${val.version}` : ""}` : "待安装"}`}</span>
                                          </div>
                                        ))}
                                      </div>
                                      {precheckResult.warnings.length > 0 && <div style={{ marginTop: 6, color: "#faad14" }}>⚠ {precheckResult.warnings.join("; ")}</div>}
                                      {precheckResult.blockers.length > 0 && <div style={{ marginTop: 6, color: "#ff4d4f" }}>🚫 {precheckResult.blockers.join("; ")}</div>}
                                    </div>
                                  )}

                                  <Text type="secondary" style={{ fontSize: 12, display: "block", marginTop: 8, marginBottom: 8 }}>
                                    {deploying ? "正在部署，请勿关闭页面..." : "部署约需 5~15 分钟，取决于网络速度"}
                                  </Text>

                                  {deployProgress && (
                                    <div style={{ marginTop: 8 }}>
                                      <Progress
                                        percent={deployProgress.progress}
                                        status={deployProgress.progress >= 100 ? "success" : "active"}
                                        size="small"
                                      />
                                      <div style={{ fontSize: 11, color: "var(--ant-color-text-tertiary)", marginTop: 4 }}>
                                        {deployProgress.message}
                                      </div>
                                    </div>
                                  )}

                                  <Collapse ghost size="small" style={{ marginTop: 8 }} items={[{
                                    key: "manual",
                                    label: <span style={{ fontSize: 12, color: "var(--ant-color-text-secondary)" }}>手动安装命令</span>,
                                    children: (
                                      <div style={{ fontSize: 12 }}>
                                        <Paragraph code style={{ fontSize: 11, margin: 0 }}>
                                          pip install mineru[all]
                                        </Paragraph>
                                        <Paragraph code style={{ fontSize: 11, margin: "4px 0 0" }}>
                                          mineru-api -p 8000
                                        </Paragraph>
                                      </div>
                                    ),
                                  }]} />
                                </div>
                              )}
                            </Card>
                          )}
                        </div>
                      ),
                    },
                  ]}
                />
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
              if (viewingTask?.result?.text) {
                navigator.clipboard.writeText(viewingTask.result.text);
                message.success("已复制");
              }
            }}
          >
            复制结果
          </Button>,
        ]}
      >
        {viewingTask?.result?.text && (
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.8, maxHeight: 400, overflow: "auto" }}>
            {viewingTask.result.text}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default DesensitizePage;