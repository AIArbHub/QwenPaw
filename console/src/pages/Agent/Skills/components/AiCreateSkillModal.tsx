import { Modal, Button, Input } from "@agentscope-ai/design";
import { useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BulbOutlined, StopOutlined } from "@ant-design/icons";
import { skillApi } from "@/api/modules/skill";
import styles from "../index.module.less";

interface AiCreateSkillModalProps {
  open: boolean;
  onClose: () => void;
  onGenerated: (content: string) => void;
}

export function AiCreateSkillModal({
  open,
  onClose,
  onGenerated,
}: AiCreateSkillModalProps) {
  const { t } = useTranslation();
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [streamedContent, setStreamedContent] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Reset when opening
  useEffect(() => {
    if (open) {
      setDescription("");
      setStreamedContent("");
      setGenerating(false);
    }
  }, [open]);

  // Auto-scroll preview as content streams in
  useEffect(() => {
    if (previewRef.current) {
      previewRef.current.scrollTop = previewRef.current.scrollHeight;
    }
  }, [streamedContent]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || generating) return;
    setGenerating(true);
    setStreamedContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const chunks: string[] = [];
      await skillApi.streamGenerateSkill(
        description.trim(),
        (text) => {
          chunks.push(text);
          setStreamedContent(chunks.join(""));
        },
        controller.signal,
      );
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error("AI skill generation failed:", err);
      }
    } finally {
      setGenerating(false);
      abortRef.current = null;
    }
  }, [description, generating]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleUseResult = useCallback(() => {
    if (streamedContent.trim()) {
      onGenerated(streamedContent.trim());
      onClose();
    }
  }, [streamedContent, onGenerated, onClose]);

  return (
    <Modal
      title={
        <span>
          <BulbOutlined style={{ marginRight: 8, color: "var(--ant-color-warning)" }} />
          {t("skills.aiCreateSkillTitle", "智能创建技能")}
        </span>
      }
      open={open}
      onCancel={onClose}
      width={600}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("common.cancel", "取消")}
        </Button>,
        <Button
          key="use"
          type="primary"
          onClick={handleUseResult}
          disabled={!streamedContent.trim()}
        >
          {t("skills.useGenerated", "使用此内容")}
        </Button>,
      ]}
      destroyOnHidden
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: "var(--ant-color-text-secondary)", marginBottom: 8 }}>
          {t("skills.aiCreateSkillDesc", "用自然语言描述你想要创建的技能，AI 会帮你生成完整的技能内容和配置。")}
        </div>
        <Input.TextArea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t(
            "skills.aiCreateSkillPlaceholder",
            '描述你想要的技能功能和使用方法，例如：\n\n"创建一个天气查询技能，支持城市名称和邮编两种输入方式，返回温度、湿度和天气状况"',
          )}
          disabled={generating}
        />
        <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {generating ? (
            <Button danger icon={<StopOutlined />} onClick={handleStop}>
              {t("skills.stopOptimize", "停止")}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<BulbOutlined />}
              onClick={handleGenerate}
              disabled={!description.trim()}
            >
              {t("skills.optimizeWithAI", "AI 生成")}
            </Button>
          )}
        </div>
      </div>

      {streamedContent && (
        <div
          ref={previewRef}
          className={styles.aiCreatePreview}
          style={{
            maxHeight: 300,
            overflow: "auto",
            padding: 12,
            background: "var(--ant-color-fill-quaternary)",
            borderRadius: 8,
            fontSize: 13,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            fontFamily: "monospace",
          }}
        >
          {streamedContent}
          {generating && (
            <span className={styles.aiCreateCursor}>|</span>
          )}
        </div>
      )}
    </Modal>
  );
}