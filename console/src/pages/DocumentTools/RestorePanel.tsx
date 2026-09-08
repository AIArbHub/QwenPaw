import { useState, useCallback } from "react";
import {
  Input,
  Button,
  message,
  Card,
  Alert,
  Row,
  Col,
  Table,
  Tag,
  Space,
  Typography,
  Upload,
  Statistic,
  Empty,
  Descriptions,
} from "antd";
import {
  UndoOutlined,
  CopyOutlined,
  UploadOutlined,
  CheckCircleFilled,
  WarningFilled,
  InfoCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  documentToolsApi,
  type RestoreResult,
} from "../../api/modules/documentTools";

const { TextArea } = Input;
const { Text } = Typography;

export default function RestorePanel() {
  const { t } = useTranslation();
  const [redactedText, setRedactedText] = useState("");
  const [mappingJson, setMappingJson] = useState("");
  const [mappingFileName, setMappingFileName] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [result, setResult] = useState<RestoreResult | null>(null);

  // 通知区域
  const [notice, setNotice] = useState<{
    tone: "info" | "error" | "success";
    text: string;
  } | null>(null);

  const handleRestore = useCallback(async () => {
    if (!redactedText.trim()) {
      message.warning(
        t("documentTools.restore.pasteText", "请先输入脱敏后的文本"),
      );
      return;
    }
    if (!mappingJson.trim()) {
      message.warning(
        t("documentTools.restore.pasteMapping", "请先输入映射文件内容"),
      );
      return;
    }
    setRestoring(true);
    setResult(null);
    setNotice(null);
    try {
      const res = await documentToolsApi.restoreText(
        redactedText,
        mappingJson,
      );
      setResult(res);
      if (res.success) {
        setNotice({
          tone: "success",
          text: `还原完成，替换 ${res.replacements.length} 处${
            res.unmatched.length > 0
              ? `，${res.unmatched.length} 个 token 未匹配`
              : ""
          }`,
        });
      } else {
        setNotice({
          tone: "error",
          text:
            res.error ||
            t("documentTools.restore.failed", "还原失败"),
        });
      }
    } catch (err: any) {
      setNotice({
        tone: "error",
        text:
          err?.message || t("documentTools.restore.failed", "还原失败"),
      });
    } finally {
      setRestoring(false);
    }
  }, [redactedText, mappingJson, t]);

  const handleUploadMapping = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        setMappingJson(String(reader.result || ""));
        setMappingFileName(file.name);
        setNotice({
          tone: "info",
          text: `映射文件「${file.name}」已加载 (${(file.size / 1024).toFixed(1)} KB)`,
        });
      };
      reader.onerror = () => {
        setNotice({
          tone: "error",
          text: "读取映射文件失败",
        });
      };
      reader.readAsText(file);
      return false;
    },
    [],
  );

  const handleClearMapping = useCallback(() => {
    setMappingJson("");
    setMappingFileName("");
  }, []);

  const handleCopyResult = useCallback(
    (txt: string) => {
      navigator.clipboard.writeText(txt);
      message.success(t("common.copied", "已复制到剪贴板"));
    },
    [t],
  );

  return (
    <div className="document-tools-restore">
      {/* 说明区 */}
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginBottom: 12 }}
        message={t(
          "documentTools.restore.description",
          "脱敏还原工具",
        )}
        description={t(
          "documentTools.restore.descriptionText",
          "将脱敏后的文本（含 Token 如 COMPANY_001、甲方等代词）还原为原始名称。需要提供脱敏时生成的映射文件（.mapping.enc）。",
        )}
      />

      {/* 通知区域 */}
      {notice && (
        <Alert
          type={
            notice.tone === "error"
              ? "error"
              : notice.tone === "success"
                ? "success"
                : "info"
          }
          showIcon
          closable
          onClose={() => setNotice(null)}
          style={{ marginBottom: 12 }}
          message={notice.text}
        />
      )}

      {/* 映射文件状态 */}
      {mappingFileName && (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          actions={[
            <DeleteOutlined key="clear" onClick={handleClearMapping} />,
          ]}
        >
          <Space>
            <CheckCircleFilled style={{ color: "#52c41a" }} />
            <Tag color="cyan">MAPPING</Tag>
            <Text strong>{mappingFileName}</Text>
          </Space>
        </Card>
      )}

      <Row gutter={16}>
        <Col span={12}>
          <Text strong>
            {t("documentTools.restore.redactedText", "脱敏后文本")}
          </Text>
          <TextArea
            value={redactedText}
            onChange={(e) => setRedactedText(e.target.value)}
            placeholder={t(
              "documentTools.restore.redactedPlaceholder",
              "粘贴脱敏后的文本（包含 COMPANY_001、A公司、甲方等 Token）...",
            )}
            rows={10}
            style={{ marginTop: 4 }}
          />
        </Col>
        <Col span={12}>
          <Space
            style={{
              marginBottom: 4,
              width: "100%",
              justifyContent: "space-between",
            }}
          >
            <Text strong>
              {t(
                "documentTools.restore.mappingContent",
                "映射文件内容",
              )}
            </Text>
            <Upload
              accept=".enc,.json"
              beforeUpload={handleUploadMapping}
              showUploadList={false}
            >
              <Button size="small" icon={<UploadOutlined />}>
                {t(
                  "documentTools.restore.loadMapping",
                  "加载映射文件",
                )}
              </Button>
            </Upload>
          </Space>
          <TextArea
            value={mappingJson}
            onChange={(e) => setMappingJson(e.target.value)}
            placeholder={t(
              "documentTools.restore.mappingPlaceholder",
              "粘贴映射文件内容（JSON 或 base64 编码），或点击上方按钮上传 .mapping.enc 文件...",
            )}
            rows={10}
            style={{
              marginTop: 4,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          />
        </Col>
      </Row>

      <div style={{ marginTop: 12, textAlign: "center" }}>
        <Button
          type="primary"
          size="large"
          icon={<UndoOutlined />}
          onClick={handleRestore}
          loading={restoring}
          disabled={!redactedText.trim() || !mappingJson.trim()}
        >
          {t("documentTools.restore.execute", "执行还原")}
        </Button>
      </div>

      {result && (
        <Card size="small" style={{ marginTop: 16 }}>
          {result.success ? (
            <>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title={t(
                      "documentTools.restore.replacements",
                      "替换数",
                    )}
                    value={result.replacements.length}
                    valueStyle={{ color: "#3f8600" }}
                    prefix={<CheckCircleFilled />}
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t(
                      "documentTools.restore.unmatched",
                      "未匹配Token",
                    )}
                    value={result.unmatched.length}
                    valueStyle={{
                      color:
                        result.unmatched.length > 0
                          ? "#fa8c16"
                          : "#3f8600",
                    }}
                    prefix={
                      result.unmatched.length > 0 ? (
                        <WarningFilled />
                      ) : (
                        <CheckCircleFilled />
                      )
                    }
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title={t(
                      "documentTools.restore.restoredLength",
                      "还原文本长度",
                    )}
                    value={result.restored_text.length}
                  />
                </Col>
              </Row>

              <div style={{ marginTop: 12 }}>
                <Space
                  style={{
                    marginBottom: 4,
                    width: "100%",
                    justifyContent: "space-between",
                  }}
                >
                  <Text strong>
                    {t(
                      "documentTools.restore.restoredText",
                      "还原后文本",
                    )}
                  </Text>
                  <Button
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() =>
                      handleCopyResult(result.restored_text)
                    }
                  >
                    {t("common.copy", "复制")}
                  </Button>
                </Space>
                <TextArea
                  value={result.restored_text}
                  readOnly
                  rows={10}
                  style={{
                    background: "#f6ffed",
                    fontFamily: "monospace",
                  }}
                />
              </div>

              {result.replacements.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <Text strong>
                    {t(
                      "documentTools.restore.replacementDetails",
                      "替换详情",
                    )}
                  </Text>
                  <Table
                    size="small"
                    style={{ marginTop: 8 }}
                    pagination={{ pageSize: 20 }}
                    dataSource={result.replacements}
                    rowKey={(r, i) => `${r.redacted}-${i}`}
                    columns={[
                      {
                        title: t(
                          "documentTools.restore.redactedForm",
                          "脱敏形式",
                        ),
                        dataIndex: "redacted",
                        width: 250,
                        render: (v: string) => (
                          <Text code>{v}</Text>
                        ),
                      },
                      {
                        title: t(
                          "documentTools.restore.originalForm",
                          "原始名称",
                        ),
                        dataIndex: "original",
                        render: (v: string) => (
                          <Tag color="green">{v}</Tag>
                        ),
                      },
                    ]}
                  />
                </div>
              )}

              {result.unmatched.length > 0 && (
                <Alert
                  type="warning"
                  showIcon
                  style={{ marginTop: 12 }}
                  message={t(
                    "documentTools.restore.unmatchedTokens",
                    "未匹配的 Token（映射文件中可能缺失）",
                  )}
                  description={
                    <Space wrap>
                      {result.unmatched.map((u, i) => (
                        <Tag key={i} color="volcano">
                          {u}
                        </Tag>
                      ))}
                    </Space>
                  }
                />
              )}

              {result.replacements.length === 0 &&
                result.unmatched.length === 0 && (
                  <Empty
                    description="未找到可替换的内容，请检查映射文件是否匹配"
                    style={{ marginTop: 16 }}
                  />
                )}
            </>
          ) : (
            <Alert
              type="error"
              showIcon
              message={
                result.error ||
                t("documentTools.restore.failed", "还原失败")
              }
            />
          )}
        </Card>
      )}
    </div>
  );
}
