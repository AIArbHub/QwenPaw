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
} from "antd";
import {
  UndoOutlined,
  CopyOutlined,
  UploadOutlined,
  CheckCircleFilled,
  WarningFilled,
  InfoCircleOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  FileTextOutlined,
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

  // 多映射文件批量还原
  const [batchMappings, setBatchMappings] = useState<Array<{ name: string; content: string }>>([]);
  const [batchResults, setBatchResults] = useState<Array<{ name: string; result: RestoreResult | null; error?: string }>>([]);

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

    // 如果有多个映射文件，执行批量还原
    if (batchMappings.length > 0) {
      setRestoring(true);
      setResult(null);
      setBatchResults([]);
      setNotice(null);
      const results: Array<{ name: string; result: RestoreResult | null; error?: string }> = [];
      let totalReplacements = 0;
      let totalUnmatched = 0;
      let currentText = redactedText;

      for (const mapping of batchMappings) {
        try {
          const res = await documentToolsApi.restoreText(currentText, mapping.content);
          results.push({ name: mapping.name, result: res });
          if (res.success) {
            totalReplacements += res.replacements.length;
            totalUnmatched += res.unmatched.length;
            // 用还原后的文本继续下一个映射
            currentText = res.restored_text;
          }
        } catch (err: any) {
          results.push({ name: mapping.name, result: null, error: err?.message || "还原失败" });
        }
      }

      setBatchResults(results);
      const lastSuccess = [...results].reverse().find(r => r.result?.success);
      if (lastSuccess?.result) {
        setResult(lastSuccess.result);
        setRedactedText(currentText);
      }
      setNotice({
        tone: totalUnmatched > 0 ? "success" : "success",
        text: `批量还原完成（${batchMappings.length} 个映射文件），共替换 ${totalReplacements} 处${totalUnmatched > 0 ? `，${totalUnmatched} 个代号未匹配` : ""}`,
      });
      setRestoring(false);
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
              ? `，${res.unmatched.length} 个代号未匹配`
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
  }, [redactedText, mappingJson, batchMappings, t]);

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

  // 批量加载映射文件（支持文件夹选择）
  const handleBatchUploadMappings = useCallback(
    (files: File[]) => {
      let loaded = 0;
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          setBatchMappings(prev => [...prev, { name: file.name, content: String(reader.result || "") }]);
          loaded++;
          if (loaded === files.length) {
            setNotice({
              tone: "info",
              text: `已加载 ${files.length} 个映射文件，点击「执行还原」将逐一应用`,
            });
          }
        };
        reader.readAsText(file);
      }
      return false;
    },
    [],
  );

  const handleClearMapping = useCallback(() => {
    setMappingJson("");
    setMappingFileName("");
  }, []);

  const handleClearBatchMappings = useCallback(() => {
    setBatchMappings([]);
    setBatchResults([]);
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
            "将脱敏后的文本（含代号如 COMPANY_001、甲方等）还原为原始名称。需要提供脱敏时生成的映射文件。",
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
      {mappingFileName && !batchMappings.length && (
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

      {/* 批量映射文件区域 — 卷宗级还原 */}
      <Card
        size="small"
        style={{ marginBottom: 12, background: "#fafafa" }}
        title={
          <Space>
            <FolderOpenOutlined />
            <span style={{ fontSize: 15 }}>映射文件（可加载多个，适用于卷宗级还原）</span>
          </Space>
        }
        extra={
          batchMappings.length > 0 ? (
            <Button size="small" danger icon={<DeleteOutlined />} onClick={handleClearBatchMappings}>
              清空
            </Button>
          ) : null
        }
      >
        {batchMappings.length === 0 ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Upload
              accept=".enc,.json"
              beforeUpload={handleUploadMapping}
              showUploadList={false}
            >
              <Button icon={<UploadOutlined />} style={{ fontSize: 15, height: 40 }}>
                加载单个映射文件
              </Button>
            </Upload>
            <Upload
              accept=".enc,.json"
              beforeUpload={(file) => { handleBatchUploadMappings([file]); return false; }}
              showUploadList={false}
              multiple
            >
              <Button icon={<FolderOpenOutlined />} style={{ fontSize: 15, height: 40 }}>
                加载多个映射文件
              </Button>
            </Upload>
            <Text type="secondary" style={{ fontSize: 13 }}>
              卷宗脱敏时，每个文件会生成单独的映射文件。加载全部映射文件后，系统会逐一还原。
            </Text>
          </Space>
        ) : (
          <div>
            {batchMappings.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: i < batchMappings.length - 1 ? "1px solid #f0f0f0" : "none" }}>
                <Space>
                  <CheckCircleFilled style={{ color: "#52c41a" }} />
                  <Tag color="cyan">{i + 1}</Tag>
                  <Text ellipsis style={{ maxWidth: 250, fontSize: 14 }}>{m.name}</Text>
                </Space>
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setBatchMappings(prev => prev.filter((_, idx) => idx !== i))} />
              </div>
            ))}
          </div>
        )}
      </Card>

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
              "粘贴脱敏后的文本（包含 COMPANY_001、A公司、甲方等代号）...",
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
              "粘贴映射文件内容，或点击上方按钮上传映射文件...",
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
          style={{ fontSize: 17, height: 48, paddingLeft: 32, paddingRight: 32 }}
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
                      "未匹配代号",
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
                    "未匹配的代号（映射文件中可能缺失）",
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

      {/* 批量还原结果 */}
      {batchResults.length > 0 && (
        <Card
          size="small"
          style={{ marginTop: 12 }}
          title={
            <Space>
              <FileTextOutlined />
              <span style={{ fontSize: 15 }}>批量还原结果（{batchResults.length} 个映射文件）</span>
            </Space>
          }
        >
          <Table
            size="small"
            pagination={false}
            dataSource={batchResults}
            rowKey={(r, i) => `${r.name}-${i}`}
            columns={[
              {
                title: "映射文件",
                dataIndex: "name",
                width: 200,
                ellipsis: true,
                render: (v: string) => <Text ellipsis style={{ maxWidth: 180 }}>{v}</Text>,
              },
              {
                title: "状态",
                width: 80,
                render: (_: any, r: any) =>
                  r.result?.success ? <Tag color="green" icon={<CheckCircleFilled />}>成功</Tag>
                  : r.error ? <Tag color="red">失败</Tag>
                  : <Tag color="blue">部分成功</Tag>,
              },
              {
                title: "替换数",
                width: 80,
                render: (_: any, r: any) => r.result?.replacements?.length ?? "-",
              },
              {
                title: "未匹配",
                width: 80,
                render: (_: any, r: any) => r.result?.unmatched?.length ?? "-",
              },
              {
                title: "错误",
                dataIndex: "error",
                ellipsis: true,
                render: (v: string) => v ? <Text type="danger">{v}</Text> : "-",
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}
