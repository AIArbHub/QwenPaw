import { useCallback, useRef, useState } from "react";
import {
  Input,
  Button,
  Switch,
  Select,
  Progress,
  Card,
  Descriptions,
  Space,
  message,
} from "antd";
import {
  PlayCircleOutlined,
  FolderOpenOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { docProcessingApi } from "@/api/modules/docProcessing";
import type {
  EngineStrategy,
  ParseResult,
  TaskStatus,
} from "@/api/modules/docProcessing";
import { browseFolder } from "@/utils/browseFolder";
import { MarkdownCopy } from "@/components/MarkdownCopy/MarkdownCopy";

const ENGINE_STRATEGY_OPTIONS: { value: EngineStrategy; labelKey: string }[] = [
  { value: "local_only", labelKey: "docSdk.engineLocalOnly" },
  { value: "hybrid", labelKey: "docSdk.engineHybrid" },
  { value: "cloud_only", labelKey: "docSdk.engineCloudOnly" },
];

export default function DocSDKParse() {
  const { t } = useTranslation();

  const [filePath, setFilePath] = useState("");
  const [autoOcr, setAutoOcr] = useState(false);
  const [enableRedaction, setEnableRedaction] = useState(false);
  const [engineStrategy, setEngineStrategy] = useState<EngineStrategy>("local_only");

  const [parsing, setParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState<"active" | "success" | "exception" | "normal">("normal");
  const [progressText, setProgressText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  const handleBrowse = useCallback(async () => {
    const result = await browseFolder();
    if (result.path) {
      setFilePath(result.path);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const handleParse = useCallback(async () => {
    if (!filePath.trim()) {
      message.warning(t("docSdk.filePathRequired"));
      return;
    }

    abortRef.current = false;
    setParsing(true);
    setProgress(0);
    setProgressStatus("active");
    setProgressText(t("docSdk.submitting"));
    setParseResult(null);

    try {
      const { task_id } = await docProcessingApi.parseDocument({
        file_path: filePath.trim(),
        auto_ocr: autoOcr,
        enable_redaction: enableRedaction,
        engine_strategy: engineStrategy,
      });

      setProgressText(t("docSdk.processing"));

      // Poll for status
      pollingRef.current = setInterval(async () => {
        if (abortRef.current) {
          stopPolling();
          return;
        }

        try {
          const status: TaskStatus = await docProcessingApi.getTaskStatus(task_id);
          setProgress(status.progress);

          if (status.message) {
            setProgressText(status.message);
          }

          if (status.status === "completed") {
            stopPolling();
            setProgressStatus("success");
            setProgress(100);
            setProgressText(t("docSdk.parseComplete"));

            // Fetch result
            try {
              const result = await docProcessingApi.getParseResult(task_id);
              setParseResult(result);
            } catch (err) {
              message.error(t("docSdk.fetchResultFailed"));
              console.error(err);
            }
            setParsing(false);
          } else if (status.status === "failed") {
            stopPolling();
            setProgressStatus("exception");
            setProgressText(status.message || t("docSdk.parseFailed"));
            message.error(status.message || t("docSdk.parseFailed"));
            setParsing(false);
          }
        } catch (err) {
          // Poll error - continue polling, network may be intermittent
          console.error("Poll error:", err);
        }
      }, 1500);
    } catch (err) {
      message.error(t("docSdk.parseSubmitFailed"));
      console.error(err);
      setParsing(false);
      setProgressStatus("exception");
      setProgressText(t("docSdk.parseSubmitFailed"));
    }
  }, [filePath, autoOcr, enableRedaction, engineStrategy, t, stopPolling]);

  const handleCopyText = useCallback(async () => {
    if (!parseResult?.text) return;
    try {
      await navigator.clipboard.writeText(parseResult.text);
      message.success(t("common.copied"));
    } catch {
      message.error(t("common.copyFailed"));
    }
  }, [parseResult, t]);

  return (
    <div>
      {/* Input Section */}
      <Card
        size="small"
        title={t("docSdk.parseInputTitle")}
        style={{ marginBottom: 16 }}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>
            {t("docSdk.filePath")}
          </div>
          <Space.Compact style={{ width: "100%" }}>
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder={t("docSdk.filePathPlaceholder")}
              style={{ flex: 1 }}
            />
            <Button
              icon={<FolderOpenOutlined />}
              onClick={handleBrowse}
            >
              {t("docSdk.browse")}
            </Button>
          </Space.Compact>
        </div>

        <Space size="large" wrap>
          <Space>
            <span>{t("docSdk.autoOcr")}:</span>
            <Switch
              size="small"
              checked={autoOcr}
              onChange={setAutoOcr}
            />
          </Space>
          <Space>
            <span>{t("docSdk.enableRedaction")}:</span>
            <Switch
              size="small"
              checked={enableRedaction}
              onChange={setEnableRedaction}
            />
          </Space>
          <Space>
            <span>{t("docSdk.engineStrategy")}:</span>
            <Select
              size="small"
              value={engineStrategy}
              onChange={setEngineStrategy}
              style={{ width: 140 }}
              options={ENGINE_STRATEGY_OPTIONS.map((opt) => ({
                value: opt.value,
                label: t(opt.labelKey),
              }))}
            />
          </Space>
        </Space>

        <div style={{ marginTop: 16 }}>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleParse}
            loading={parsing}
            disabled={!filePath.trim()}
          >
            {t("docSdk.startParse")}
          </Button>
        </div>
      </Card>

      {/* Progress */}
      {(parsing || progress > 0) && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Progress
            percent={progress}
            status={progressStatus}
            format={(pct) => `${pct}%`}
          />
          {progressText && (
            <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>
              {progressText}
            </div>
          )}
        </Card>
      )}

      {/* Result */}
      {parseResult && (
        <>
          {/* Markdown Preview */}
          {parseResult.markdown && (
            <Card
              size="small"
              title={t("docSdk.markdownPreview")}
              style={{ marginBottom: 16 }}
            >
              <MarkdownCopy content={parseResult.markdown} />
            </Card>
          )}

          {/* Text Content */}
          {parseResult.text && (
            <Card
              size="small"
              title={
                <Space>
                  <span>{t("docSdk.textContent")}</span>
                  <Button
                    type="link"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={handleCopyText}
                  >
                    {t("common.copy")}
                  </Button>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <div
                style={{
                  maxHeight: 400,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  background: "#fafafa",
                  padding: 12,
                  borderRadius: 4,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {parseResult.text}
              </div>
            </Card>
          )}

          {/* Metadata */}
          {parseResult.metadata && Object.keys(parseResult.metadata).length > 0 && (
            <Card size="small" title={t("docSdk.metadata")}>
              <Descriptions column={2} size="small" bordered>
                {Object.entries(parseResult.metadata).map(([key, value]) => (
                  <Descriptions.Item key={key} label={key}>
                    {typeof value === "object"
                      ? JSON.stringify(value, null, 2)
                      : String(value)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            </Card>
          )}

          {/* Error */}
          {parseResult.error && (
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ color: "#ff4d4f" }}>{parseResult.error}</div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}