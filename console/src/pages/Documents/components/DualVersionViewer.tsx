import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Segmented,
  Spin,
  Empty,
  Alert,
  Tag,
  Space,
  Typography,
  Tooltip,
} from "antd";
import {
  FileTextOutlined,
  SafetyOutlined,
  LockOutlined,
  EyeOutlined,
  DiffOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { knowledgeApi } from "@/api/modules/knowledge";
import type { KnowledgeDoc } from "@/api/modules/knowledge";

const { Text } = Typography;

interface DualVersionViewerProps {
  doc: KnowledgeDoc;
  /** Whether the user is authorized to view original content */
  authorized?: boolean;
}

type ViewMode = "desensitized" | "original" | "diff";

export default function DualVersionViewer({
  doc,
  authorized = false,
}: DualVersionViewerProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ViewMode>("desensitized");
  const [originalContent, setOriginalContent] = useState("");
  const [desensitizedContent, setDesensitizedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [showOriginalAuthorized, setShowOriginalAuthorized] = useState(false);

  const loadContent = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "original" || mode === "diff") {
        if (!originalContent) {
          const res = await knowledgeApi.getParsedContent(doc.id);
          setOriginalContent(res.content);
        }
      }
      if (mode === "desensitized" || mode === "diff") {
        if (!desensitizedContent) {
          const res = await knowledgeApi.getDesensitizedContent(doc.id);
          setDesensitizedContent(res.content);
        }
      }
    } catch (e) {
      console.error("Failed to load content:", e);
    } finally {
      setLoading(false);
    }
  }, [mode, doc.id, originalContent, desensitizedContent]);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const handleAuthorizeOriginal = () => {
    setShowOriginalAuthorized(true);
    setMode("original");
  };

  const canViewOriginal = authorized || showOriginalAuthorized;

  // Simple line-level diff
  const renderDiff = () => {
    if (!originalContent || !desensitizedContent) return null;

    const origLines = originalContent.split("\n");
    const desensLines = desensitizedContent.split("\n");
    const maxLines = Math.max(origLines.length, desensLines.length);

    const lines: React.ReactNode[] = [];
    for (let i = 0; i < maxLines; i++) {
      const orig = origLines[i] || "";
      const desens = desensLines[i] || "";

      if (orig === desens) {
        lines.push(
          <div key={i} style={{ padding: "2px 8px", whiteSpace: "pre-wrap" }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {i + 1}
            </Text>{" "}
            {orig}
          </div>,
        );
      } else {
        if (orig) {
          lines.push(
            <div
              key={`o-${i}`}
              style={{
                padding: "2px 8px",
                whiteSpace: "pre-wrap",
                background: "rgba(255,77,79,0.08)",
                borderLeft: "3px solid #ff4d4f",
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {i + 1}
              </Text>{" "}
              <Text delete style={{ color: "#ff4d4f" }}>
                {orig}
              </Text>
            </div>,
          );
        }
        if (desens) {
          lines.push(
            <div
              key={`d-${i}`}
              style={{
                padding: "2px 8px",
                whiteSpace: "pre-wrap",
                background: "rgba(82,196,26,0.08)",
                borderLeft: "3px solid #52c41a",
              }}
            >
              <Text type="secondary" style={{ fontSize: 12 }}>
                {i + 1}
              </Text>{" "}
              <Text style={{ color: "#52c41a" }}>{desens}</Text>
            </div>,
          );
        }
      }
    }

    return (
      <div
        style={{
          fontFamily: "monospace",
          fontSize: 13,
          lineHeight: 1.6,
          maxHeight: 500,
          overflowY: "auto",
          border: "1px solid var(--ant-color-border)",
          borderRadius: 6,
        }}
      >
        {lines}
      </div>
    );
  };

  return (
    <div>
      {/* Version selector */}
      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as ViewMode)}
          options={[
            {
              label: (
                <Space size={4}>
                  <SafetyOutlined />
                  {t("documents.version.desensitized")}
                </Space>
              ),
              value: "desensitized",
            },
            {
              label: (
                <Space size={4}>
                  <FileTextOutlined />
                  {t("documents.version.original")}
                </Space>
              ),
              value: "original",
              disabled: !canViewOriginal,
            },
            {
              label: (
                <Space size={4}>
                  <DiffOutlined />
                  {t("documents.version.diffView")}
                </Space>
              ),
              value: "diff",
              disabled: !canViewOriginal,
            },
          ]}
        />

        {doc.desensitized ? (
          <Tag color="green">✓ {t("documents.pipeline.desensitized")}</Tag>
        ) : (
          <Tag color="orange">{t("documents.pipeline.pending")}</Tag>
        )}

        <Tooltip title={t("documents.version.originalForbidden")}>
          {!canViewOriginal && (
            <Button
              size="small"
              icon={<LockOutlined />}
              onClick={handleAuthorizeOriginal}
            >
              {t("documents.version.switchVersion")}
            </Button>
          )}
        </Tooltip>

        {(mode === "desensitized" || mode === "original") && !loading && (
          <Button
            size="small"
            icon={<CopyOutlined />}
            onClick={() => {
              const content =
                mode === "desensitized" ? desensitizedContent : originalContent;
              navigator.clipboard.writeText(content);
            }}
          >
            Copy
          </Button>
        )}
      </Space>

      {/* Authorization warning */}
      {mode === "original" && !canViewOriginal && (
        <Alert
          type="warning"
          message={t("documents.version.originalForbidden")}
          action={
            <Button size="small" onClick={handleAuthorizeOriginal}>
              <EyeOutlined /> {t("documents.version.switchVersion")}
            </Button>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {showOriginalAuthorized && (
        <Alert
          type="info"
          message={t("documents.version.originalAuthorized")}
          style={{ marginBottom: 12 }}
        />
      )}

      {/* Content */}
      <Spin spinning={loading}>
        {mode === "desensitized" &&
          (desensitizedContent ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 500,
                overflowY: "auto",
                padding: 12,
                border: "1px solid var(--ant-color-border)",
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {desensitizedContent}
            </pre>
          ) : (
            <Empty description={t("knowledge.noDesensitizedContent")} />
          ))}

        {mode === "original" &&
          canViewOriginal &&
          (originalContent ? (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 500,
                overflowY: "auto",
                padding: 12,
                border: "1px solid var(--ant-color-border)",
                borderRadius: 6,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              {originalContent}
            </pre>
          ) : (
            <Empty description={t("knowledge.noParsedContent")} />
          ))}

        {mode === "diff" && canViewOriginal && renderDiff()}
      </Spin>
    </div>
  );
}
