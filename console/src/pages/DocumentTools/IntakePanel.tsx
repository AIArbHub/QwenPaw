import { useState, useCallback } from "react";
import {
  Tabs,
  Input,
  Button,
  Upload,
  message,
  Card,
  Descriptions,
  Tag,
  Alert,
  Statistic,
  Row,
  Col,
  Spin,
  Empty,
  Typography,
} from "antd";
import {
  InboxOutlined,
  SearchOutlined,
  FileTextOutlined,
  WarningFilled,
  CheckCircleFilled,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  documentToolsApi,
  type IntakeResult,
  type IntakeTextResult,
} from "../../api/modules/documentTools";
import { docTypeColor } from "./utils";

const { TextArea } = Input;
const { Text } = Typography;

export default function IntakePanel() {
  const { t } = useTranslation();

  // --- Text analysis ---
  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [textResult, setTextResult] = useState<IntakeTextResult | null>(null);

  // --- File upload ---
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<IntakeResult | null>(null);

  const handleAnalyzeText = useCallback(async () => {
    if (!text.trim()) {
      message.warning(t("documentTools.intake.pasteFirst", "请先粘贴文本"));
      return;
    }
    setAnalyzing(true);
    setTextResult(null);
    try {
      const result = await documentToolsApi.intakeText(text);
      setTextResult(result);
    } catch (err: any) {
      message.error(err?.message || t("documentTools.intake.analyzeFailed", "分析失败"));
    } finally {
      setAnalyzing(false);
    }
  }, [text, t]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setUploadResult(null);
      try {
        const result = await documentToolsApi.intakeUpload(file);
        setUploadResult(result);
        message.success(
          t("documentTools.intake.uploadSuccess", "解析完成：") +
            result.doc_type_label,
        );
      } catch (err: any) {
        message.error(err?.message || t("documentTools.intake.uploadFailed", "上传解析失败"));
      } finally {
        setUploading(false);
      }
      return false; // prevent antd auto upload
    },
    [t],
  );

  return (
    <div className="document-tools-intake">
      <Tabs
        defaultActiveKey="text"
        items={[
          {
            key: "text",
            label: (
              <span>
                <SearchOutlined /> {t("documentTools.intake.textAnalysis", "文本分析")}
              </span>
            ),
            children: (
              <div>
                <TextArea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t(
                    "documentTools.intake.textPlaceholder",
                    "粘贴仲裁文书、合同、法律意见书等文本内容，系统将自动识别文档类型并提取关键实体...",
                  )}
                  rows={8}
                  showCount
                  maxLength={50000}
                />
                <div style={{ marginTop: 12, textAlign: "right" }}>
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={handleAnalyzeText}
                    loading={analyzing}
                    disabled={!text.trim()}
                  >
                    {t("documentTools.intake.analyze", "分析文档类型")}
                  </Button>
                </div>

                {analyzing && (
                  <div style={{ textAlign: "center", padding: 40 }}>
                    <Spin tip={t("common.loading", "加载中...")} />
                  </div>
                )}

                {textResult && <TextAnalysisResult result={textResult} />}
              </div>
            ),
          },
          {
            key: "upload",
            label: (
              <span>
                <InboxOutlined /> {t("documentTools.intake.fileUpload", "文件解析")}
              </span>
            ),
            children: (
              <div>
                <Upload.Dragger
                  accept=".pdf,.docx,.doc,.txt,.md,.markdown,.html,.htm"
                  beforeUpload={handleUpload}
                  showUploadList={false}
                  disabled={uploading}
                >
                  {uploading ? (
                    <div style={{ padding: 40 }}>
                      <Spin
                        tip={t(
                          "documentTools.intake.processing",
                          "正在解析文档...",
                        )}
                      />
                    </div>
                  ) : (
                    <>
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined />
                      </p>
                      <p className="ant-upload-text">
                        {t(
                          "documentTools.intake.dragOrClick",
                          "点击或拖拽文件到此处上传",
                        )}
                      </p>
                      <p className="ant-upload-hint">
                        {t(
                          "documentTools.intake.supportedFormats",
                          "支持 PDF、DOCX、TXT、MD、HTML 格式",
                        )}
                      </p>
                    </>
                  )}
                </Upload.Dragger>

                {uploadResult && <UploadResult result={uploadResult} />}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

// -- Sub-components ---------------------------------------------------------

function TextAnalysisResult({ result }: { result: IntakeTextResult }) {
  const { t } = useTranslation();

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Descriptions
        title={t("documentTools.intake.analysisResult", "分析结果")}
        column={2}
        bordered
        size="small"
      >
        <Descriptions.Item
          label={t("documentTools.intake.docType", "文档类型")}
        >
          <Tag color={docTypeColor(result.doc_type)}>
            {result.doc_type_label}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item
          label={t("documentTools.intake.confidence", "置信度")}
        >
          <Text type={result.confidence > 0.5 ? "success" : "warning"}>
            {(result.confidence * 100).toFixed(1)}%
          </Text>
        </Descriptions.Item>
        <Descriptions.Item
          label={t("documentTools.intake.charCount", "字符数")}
        >
          {result.char_count.toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item
          label={t("documentTools.intake.entityTypes", "实体类型数")}
        >
          {Object.keys(result.entity_type_counts).length}
        </Descriptions.Item>
      </Descriptions>

      {result.matched_keywords.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong>
            {t("documentTools.intake.matchedKeywords", "匹配关键词")}
          </Text>
          <div style={{ marginTop: 4 }}>
            {result.matched_keywords.map((kw, i) => (
              <Tag key={i} color="blue">
                {kw.keyword} ×{kw.count}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {result.entity_preview.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Text strong>
            {t("documentTools.intake.entityPreview", "实体预览（前30条）")}
          </Text>
          <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
            {result.entity_preview.map((e, i) => (
              <Col key={i} span={12}>
                <Tag color="geekblue">{e.type}</Tag>
                <Text ellipsis style={{ maxWidth: 200 }}>
                  {e.text}
                </Text>
              </Col>
            ))}
          </Row>
        </div>
      )}

      {result.entity_preview.length === 0 && (
        <Empty
          description={t(
            "documentTools.intake.noEntities",
            "未提取到法律实体",
          )}
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
}

function UploadResult({ result }: { result: IntakeResult }) {
  const { t } = useTranslation();

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      <Row gutter={16}>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.pages", "页数")}
            value={result.page_count}
            prefix={<FileTextOutlined />}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.blocks", "块数")}
            value={result.block_count}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.chars", "字符数")}
            value={result.char_count}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.docTypeLabel", "文档类型")}
            valueRender={() => (
              <Tag color={docTypeColor(result.doc_type)}>
                {result.doc_type_label}
              </Tag>
            )}
            value={result.doc_type_label}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.confidence", "置信度")}
            value={(result.doc_type_confidence * 100).toFixed(1)}
            suffix="%"
            valueStyle={{
              color: result.doc_type_confidence > 0.5 ? "#3f8600" : "#fa8c16",
            }}
          />
        </Col>
        <Col span={4}>
          <Statistic
            title={t("documentTools.intake.ocrEngine", "OCR引擎")}
            value={result.ocr_engine}
            valueStyle={{ fontSize: 14 }}
          />
        </Col>
      </Row>

      {result.human_review_recommended && (
        <Alert
          type="warning"
          icon={<WarningFilled />}
          showIcon
          style={{ marginTop: 12 }}
          message={t(
            "documentTools.intake.reviewRecommended",
            "建议人工复核",
          )}
          description={result.recommendations.join("；")}
        />
      )}

      {!result.human_review_recommended && (
        <Alert
          type="success"
          icon={<CheckCircleFilled />}
          showIcon
          style={{ marginTop: 12 }}
          message={t(
            "documentTools.intake.reviewPassed",
            "文档质量良好，无需人工复核",
          )}
        />
      )}

      {result.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 8 }}
          message={t("common.warnings", "警告")}
          description={
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <Descriptions
        size="small"
        column={1}
        bordered
        style={{ marginTop: 12 }}
      >
        <Descriptions.Item
          label={t("documentTools.intake.sourceHash", "来源哈希")}
        >
          <Text code copyable>
            {result.source_hash}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item
          label={t("documentTools.intake.semanticSummary", "语义摘要")}
        >
          <Tag>chunks: {result.semantic_summary.chunk_count}</Tag>
          <Tag>entities: {result.semantic_summary.entity_count}</Tag>
          <Tag>clause_refs: {result.semantic_summary.clause_ref_count}</Tag>
          {result.semantic_summary.has_article_structure && (
            <Tag color="green">
              {t("documentTools.intake.hasArticles", "含条文结构")}
            </Tag>
          )}
        </Descriptions.Item>
      </Descriptions>

      {result.markdown_preview && (
        <div style={{ marginTop: 12 }}>
          <Text strong>
            {t("documentTools.intake.markdownPreview", "Markdown 预览")}
          </Text>
          <pre
            style={{
              background: "#f5f5f5",
              padding: 12,
              borderRadius: 6,
              maxHeight: 300,
              overflow: "auto",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {result.markdown_preview}
          </pre>
        </div>
      )}
    </Card>
  );
}
