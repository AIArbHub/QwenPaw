import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  Button,
  Card,
  message,
  Modal,
  Upload,
  Table,
  Tag,
  Spinner,
} from "@agentscope-ai/design";
import { Steps, Input, Form, Select, Space, Tooltip, Alert, Popconfirm } from "antd";
import { useTranslation } from "react-i18next";
import {
  PlusOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  SearchOutlined,
  UploadOutlined,
  CrownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ExclamationCircleOutlined,
  PictureOutlined,
  SwapOutlined,
  RobotOutlined,
  LinkOutlined,
  DisconnectOutlined,
  MessageOutlined,
  SendOutlined,
  LoadingOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import styles from "./index.module.less";

const PET_API_BASE = "/api/aiarb-pet";

// ---------------------------------------------------------------------------
// Types — match the backend contracts documented in the task spec.
// ---------------------------------------------------------------------------

/** One row from `GET /pets` → `{folder, manifestId, id, displayName, path}`. */
interface PetEntry {
  folder: string;
  manifestId: string;
  id: string;
  displayName: string;
  path: string;
}

interface DesktopHealth {
  running: boolean;
  pid?: number;
  port?: number;
}

interface StatusResponse {
  ok: boolean;
  plugin: string;
  desktop: DesktopHealth;
}

/** One item from `GET /templates` → `{id, name, description, tags}`. */
interface PetTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

type ColorTone = "golden" | "cool" | "warm" | "natural";

interface CreatePetPayload {
  pet_id: string;
  display_name: string;
  description: string;
  color_tone: ColorTone;
}

/** One row from `GET /api/agents` → `{id, name, description, enabled, ...}`. */
interface AgentEntry {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/** One row from `GET /bindings` → `{pet_id, agent_id, agent_name, session_id}`. */
interface PetBinding {
  pet_id: string;
  agent_id: string;
  agent_name: string;
  session_id?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PET_ID_RE = /^[a-zA-Z0-9._-]+$/;

// Spritesheet atlas spec — must match backend sprites.py
const SPRITESHEET_SPEC = {
  width: 1536,
  height: 1872,
  cellWidth: 192,
  cellHeight: 208,
  columns: 8,
  rows: 9,
};

/** Validate an uploaded image file matches the atlas spec. Returns error string or null. */
async function validateSpritesheetFile(file: File): Promise<string | null> {
  // Check extension
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext !== "webp" && ext !== "png" && ext !== "jpg" && ext !== "jpeg") {
    return "pet.spriteInvalidFormat";
  }
  // Check dimensions via Image element
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width !== SPRITESHEET_SPEC.width || img.height !== SPRITESHEET_SPEC.height) {
        resolve("pet.spriteInvalidSize");
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve("pet.spriteInvalidFile");
    };
    img.src = url;
  });
}

const COLOR_TONES: { value: ColorTone; color: string; labelKey: string }[] = [
  { value: "golden", color: "#F5B642", labelKey: "pet.toneGolden" },
  { value: "cool", color: "#4A90E2", labelKey: "pet.toneCool" },
  { value: "warm", color: "#E27B4A", labelKey: "pet.toneWarm" },
  { value: "natural", color: "#8BB174", labelKey: "pet.toneNatural" },
];

/** Build a safe pet_id default from a free-form display name. */
function slugifyFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "my-pet";
}

/** Split a natural-language query into comparable tokens. */
function tokenizeForMatch(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[\s,，。、;；!！?？()（）[\]【】]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Score how well a piece of text matches a template's tags.
 *
 * Implements the spec's "tokenise input, intersect with tags, pick the
 * most matches" rule. Substring containment is used as a fallback so
 * "golden lion" still hits a "gold" tag — the highest score still
 * wins, which keeps the behaviour intuitive.
 */
function matchScore(query: string, tags: string[]): number {
  const tokens = tokenizeForMatch(query);
  if (tokens.length === 0) return 0;
  const lowerTags = tags.map((t) => t.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    for (const tag of lowerTags) {
      if (tag === token) score += 2;
      else if (tag.includes(token) || token.includes(tag)) score += 1;
    }
  }
  return score;
}

function templatePreviewUrl(id: string): string {
  return `${PET_API_BASE}/templates/${encodeURIComponent(id)}/spritesheet`;
}

/**
 * Spritesheet preview that degrades gracefully to a placeholder when
 * the backend has no preview image for a template (or the request
 * 404s), so the wizard never shows a broken-image icon.
 */
function TemplatePreview({
  id,
  alt,
  width = 96,
  height = 104,
}: {
  id: string;
  alt: string;
  width?: number;
  height?: number;
}) {
  const [errored, setErrored] = useState(false);
  if (errored) {
    return (
      <div
        style={{
          width,
          height,
          background: "var(--ant-color-fill-tertiary)",
          borderRadius: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ant-color-text-tertiary)",
          fontSize: 11,
        }}
      >
        ?
      </div>
    );
  }
  return (
    <img
      src={templatePreviewUrl(id)}
      alt={alt}
      onError={() => setErrored(true)}
      style={{
        width,
        height,
        objectFit: "none",
        objectPosition: "0 0",
        imageRendering: "pixelated",
        borderRadius: 4,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Create-pet wizard (Steps + Modal). Replaces the old .zip upload modal.
// ---------------------------------------------------------------------------

interface CreatePetWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreatePetWizard({ open, onClose, onCreated }: CreatePetWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<PetTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [aiQuery, setAiQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<CreatePetPayload>();
  const petIdDirtyRef = useRef(false);
  const displayNameValue = Form.useWatch("display_name", form);

  // Load templates + reset state every time the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setSelectedTemplateId(null);
    setAiQuery("");
    setTemplates([]);
    petIdDirtyRef.current = false;
    form.resetFields();
    form.setFieldsValue({
      pet_id: "",
      display_name: "",
      description: "",
      color_tone: "golden",
    });

    let cancelled = false;
    setTemplatesLoading(true);
    fetch(`${PET_API_BASE}/templates`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setTemplates(Array.isArray(data.templates) ? data.templates : []);
      })
      .catch(() => {
        if (!cancelled) setTemplates([]);
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, form]);

  // Auto-derive pet_id from display_name until the user manually edits it.
  useEffect(() => {
    if (!open) return;
    if (!petIdDirtyRef.current) {
      form.setFieldValue("pet_id", slugifyFromName(displayNameValue || ""));
    }
  }, [displayNameValue, form, open]);

  // AI recommendation: highest-scoring template for the current query.
  const recommendedId = useMemo(() => {
    const q = aiQuery.trim();
    if (!q || templates.length === 0) return null;
    let best: string | null = null;
    let bestScore = 0;
    for (const tpl of templates) {
      const score = matchScore(q, tpl.tags);
      if (score > bestScore) {
        bestScore = score;
        best = tpl.id;
      }
    }
    return bestScore > 0 ? best : null;
  }, [aiQuery, templates]);

  const selectedTemplate = useMemo(
    () => templates.find((tpl) => tpl.id === selectedTemplateId) || null,
    [templates, selectedTemplateId],
  );

  const handleNext = async () => {
    if (step === 0) {
      if (!selectedTemplateId) {
        message.warning(t("pet.wizardSelectTemplate", "请先选择一个形象"));
        return;
      }
      setStep(1);
    } else if (step === 1) {
      try {
        await form.validateFields();
        setStep(2);
      } catch {
        // validation messages are rendered inline by Form.Item
      }
    }
  };

  const handlePrev = () => setStep((s) => Math.max(0, s - 1));

  const handleCreate = async () => {
    if (!selectedTemplateId) {
      message.warning(t("pet.wizardSelectTemplate", "请先选择一个形象"));
      setStep(0);
      return;
    }
    try {
      const values = await form.validateFields();
      setCreating(true);
      const res = await fetch(`${PET_API_BASE}/create-pet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pet_id: values.pet_id,
          display_name: values.display_name,
          description: values.description || "",
          template_id: selectedTemplateId,
          color_tone: values.color_tone,
        } as CreatePetPayload & { template_id: string }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        message.success(
          t("pet.createSuccess", "已创建 {name}").replace(
            "{name}",
            String(data.displayName || values.display_name || ""),
          ),
        );
        onCreated();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.createFailed", "创建失败"));
      }
    } catch {
      message.error(t("pet.createFailed", "创建失败"));
    } finally {
      setCreating(false);
    }
  };

  // ---- per-step render ----

  const renderStep1 = (): ReactNode => {
    if (templatesLoading) {
      return (
        <div style={{ textAlign: "center", padding: 40 }}>
          <Spinner />
        </div>
      );
    }
    if (templates.length === 0) {
      return (
        <div className={styles.wizardEmpty}>
          {t("pet.templatesEmpty", "暂可用模板")}
        </div>
      );
    }
    return (
      <div className={styles.wizardStep}>
        <div className={styles.aiRecommendRow}>
          <SearchOutlined style={{ color: "var(--ant-color-text-tertiary)" }} />
          <Input
            allowClear
            value={aiQuery}
            onChange={(e) => setAiQuery(e.target.value)}
            placeholder={t(
              "pet.wizardAiPlaceholder",
              "描述你想要的宠物，例如：一只勇敢的金色狮子",
            )}
          />
          {recommendedId && (
            <Tooltip title={t("pet.wizardAiRecommendHint", "根据描述推荐")}>
              <Tag color="gold" icon={<CrownOutlined />}>
                {t("pet.wizardAiRecommend", "推荐")}
              </Tag>
            </Tooltip>
          )}
        </div>

        <div className={styles.templateGrid}>
          {templates.map((tpl) => {
            const selected = tpl.id === selectedTemplateId;
            const recommended = tpl.id === recommendedId;
            return (
              <div
                key={tpl.id}
                className={[
                  styles.templateCard,
                  selected ? styles.templateCardSelected : "",
                  recommended ? styles.templateCardRecommended : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => setSelectedTemplateId(tpl.id)}
              >
                <div className={styles.templateCardPreview}>
                  <TemplatePreview id={tpl.id} alt={tpl.name} width={72} height={80} />
                </div>
                <div className={styles.templateCardName}>{tpl.name}</div>
                <div className={styles.templateCardDesc}>
                  {tpl.description || t("pet.wizardNoDescription", "暂无描述")}
                </div>
                <div className={styles.templateCardTags}>
                  {tpl.tags.slice(0, 4).map((tag) => (
                    <Tag key={tag} style={{ marginInlineEnd: 4 }}>
                      {tag}
                    </Tag>
                  ))}
                </div>
                {selected && (
                  <div className={styles.selectedBadge}>
                    <CheckCircleFilled />
                  </div>
                )}
                {recommended && !selected && (
                  <div className={styles.recommendBadge}>
                    <CrownOutlined /> {t("pet.wizardAiRecommend", "推荐")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderStep2 = (): ReactNode => (
    <div className={styles.wizardStep}>
      <Form form={form} layout="vertical" requiredMark>
        <Form.Item
          name="display_name"
          label={t("pet.fieldDisplayName", "显示名称")}
          rules={[
            {
              required: true,
              message: t("pet.displayNameRequired", "请输入显示名称"),
            },
          ]}
        >
          <Input
            placeholder={t("pet.fieldDisplayNamePlaceholder", "如：小金")}
            maxLength={64}
          />
        </Form.Item>

        <Form.Item
          name="pet_id"
          label={t("pet.fieldPetId", "宠物ID")}
          extra={t(
            "pet.fieldPetIdHint",
            "用作文件夹名，仅允许字母、数字、点、下划线、短横线",
          )}
          rules={[
            {
              required: true,
              message: t("pet.petIdRequired", "请输入宠物ID"),
            },
            {
              pattern: PET_ID_RE,
              message: t(
                "pet.petIdInvalid",
                "宠物ID只能包含字母、数字、._-",
              ),
            },
          ]}
        >
          <Input
            placeholder="my-pet"
            maxLength={64}
            onChange={() => {
              petIdDirtyRef.current = true;
            }}
          />
        </Form.Item>

        <Form.Item name="description" label={t("pet.fieldDescription", "描述")}>
          <Input.TextArea
            rows={3}
            maxLength={500}
            placeholder={t(
              "pet.fieldDescriptionPlaceholder",
              "描述这个宠物的性格、故事…",
            )}
          />
        </Form.Item>

        <Form.Item
          name="color_tone"
          label={t("pet.fieldColorTone", "色调")}
          rules={[{ required: true }]}
        >
          <Select
            options={COLOR_TONES.map((tone) => ({
              value: tone.value,
              label: (
                <Space>
                  <span
                    className={styles.colorDot}
                    style={{ background: tone.color }}
                  />
                  {t(tone.labelKey, tone.value)}
                </Space>
              ),
            }))}
          />
        </Form.Item>
      </Form>

      <Alert
        type="info"
        showIcon
        icon={<PictureOutlined />}
        style={{ marginTop: 12, fontSize: 12 }}
        message={t("pet.spriteSpecTitle", "精灵图规格要求")}
        description={
          <span>
            {SPRITESHEET_SPEC.width}×{SPRITESHEET_SPEC.height}px
            ({SPRITESHEET_SPEC.columns}列×{SPRITESHEET_SPEC.rows}行，每帧{SPRITESHEET_SPEC.cellWidth}×{SPRITESHEET_SPEC.cellHeight}px)
            {" — "}
            {t("pet.spriteCustomHint", "创建后可在列表中点击替换按钮上传自定义像素艺术精灵图")}
          </span>
        }
      />

      {selectedTemplate && (
        <div className={styles.previewBox}>
          <div className={styles.previewBoxLabel}>
            {t("pet.wizardPreview", "预览")}
          </div>
          <TemplatePreview
            id={selectedTemplate.id}
            alt={selectedTemplate.name}
            width={96}
            height={104}
          />
        </div>
      )}
    </div>
  );

  const renderStep3 = (): ReactNode => {
    const values = form.getFieldsValue();
    const tone = COLOR_TONES.find((t2) => t2.value === values.color_tone);
    return (
      <div className={styles.wizardStep}>
        <div className={styles.summaryList}>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>
              {t("pet.wizardTemplateName", "模板")}
            </span>
            <span className={styles.summaryValue}>
              {selectedTemplate ? (
                <Space>
                  {selectedTemplate.name}
                  {selectedTemplate.tags.slice(0, 3).map((tag) => (
                    <Tag key={tag}>{tag}</Tag>
                  ))}
                </Space>
              ) : (
                "-"
              )}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>
              {t("pet.fieldPetId", "宠物ID")}
            </span>
            <span className={styles.summaryValue}>
              <code>{values.pet_id || "-"}</code>
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>
              {t("pet.fieldDisplayName", "显示名称")}
            </span>
            <span className={styles.summaryValue}>
              {values.display_name || "-"}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>
              {t("pet.fieldDescription", "描述")}
            </span>
            <span className={styles.summaryValue}>
              {values.description || "-"}
            </span>
          </div>
          <div className={styles.summaryRow}>
            <span className={styles.summaryKey}>
              {t("pet.fieldColorTone", "色调")}
            </span>
            <span className={styles.summaryValue}>
              {tone ? (
                <Space>
                  <span
                    className={styles.colorDot}
                    style={{ background: tone.color }}
                  />
                  {t(tone.labelKey, tone.value)}
                </Space>
              ) : (
                "-"
              )}
            </span>
          </div>
        </div>
        {selectedTemplate && (
          <div className={styles.previewBox}>
            <TemplatePreview
              id={selectedTemplate.id}
              alt={selectedTemplate.name}
              width={96}
              height={104}
            />
          </div>
        )}
      </div>
    );
  };

  // ---- footer (step-aware) ----

  const footer = (
    <div className={styles.wizardFooter}>
      <Button onClick={onClose}>{t("pet.wizardCancel", "取消")}</Button>
      <div className={styles.wizardFooterRight}>
        {step > 0 && (
          <Button icon={<ArrowLeftOutlined />} onClick={handlePrev}>
            {t("pet.wizardPrev", "上一步")}
          </Button>
        )}
        {step < 2 ? (
          <Button type="primary" icon={<ArrowRightOutlined />} onClick={handleNext}>
            {t("pet.wizardNext", "下一步")}
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<CheckCircleFilled />}
            loading={creating}
            onClick={handleCreate}
          >
            {t("pet.wizardCreate", "创建")}
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      title={t("pet.wizardTitle", "创建新宠物")}
      open={open}
      onCancel={onClose}
      width={760}
      footer={footer}
      destroyOnHidden
      maskClosable={false}
    >
      <Steps
        size="small"
        current={step}
        style={{ marginBottom: 20 }}
        items={[
          { title: t("pet.wizardStep1", "选择形象") },
          { title: t("pet.wizardStep2", "个性化设置") },
          { title: t("pet.wizardStep3", "确认创建") },
        ]}
      />
      {step === 0 && renderStep1()}
      {step === 1 && renderStep2()}
      {step === 2 && renderStep3()}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Advanced import modal (kept as a "high-level option" entry point).
// ---------------------------------------------------------------------------

interface AdvancedImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

function AdvancedImportModal({
  open,
  onClose,
  onImported,
}: AdvancedImportModalProps) {
  const { t } = useTranslation();
  const [importing, setImporting] = useState(false);
  const uploadRef = useRef<{ file: File | null; path: string }>({
    file: null,
    path: "",
  });

  const handleConfirm = async () => {
    if (!uploadRef.current.file) {
      message.warning(t("pet.importChooseFirst", "请先选择文件"));
      return;
    }
    setImporting(true);
    try {
      const formData = new FormData();
      formData.append("file", uploadRef.current.file);
      const res = await fetch(`${PET_API_BASE}/import-pet-upload`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        message.success(
          t("pet.importSuccess", "已导入 {name}").replace(
            "{name}",
            String(data.name || data.displayName || ""),
          ),
        );
        uploadRef.current = { file: null, path: "" };
        onClose();
        onImported();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.importFailed", "导入失败"));
      }
    } catch {
      message.error(t("pet.importFailed", "导入失败"));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      title={t("pet.modalImportTitle", "从文件导入宠物")}
      open={open}
      onCancel={onClose}
      onOk={handleConfirm}
      confirmLoading={importing}
      okText={t("pet.modalImportOk", "导入")}
      destroyOnHidden
    >
      <div
        style={{
          marginBottom: 12,
          fontSize: 12,
          color: "var(--ant-color-text-tertiary)",
        }}
      >
        {t(
          "pet.importFormatHint",
          "文件夹或解压后的目录需包含 pet.json 与 spritesheet.webp（1536×1872）",
        )}
      </div>
      <Upload.Dragger
        accept=".zip"
        maxCount={1}
        beforeUpload={(file: File) => {
          uploadRef.current = { file, path: file.name };
          return false;
        }}
        onRemove={() => {
          uploadRef.current = { file: null, path: "" };
        }}
      >
        <p className="ant-upload-drag-icon">
          <UploadOutlined />
        </p>
        <p className="ant-upload-text">
          {t("pet.dropzoneTitle", "将 .zip 文件拖放到此处")}
        </p>
        <p className="ant-upload-hint">
          {t("pet.dropzoneHint", "或点击选择 .zip 文件")}
        </p>
      </Upload.Dragger>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Replace spritesheet modal — upload a custom pixel-art spritesheet
// ---------------------------------------------------------------------------

interface ReplaceSpritesheetModalProps {
  open: boolean;
  pet: PetEntry | null;
  onClose: () => void;
  onReplaced: () => void;
}

function ReplaceSpritesheetModal({
  open,
  pet,
  onClose,
  onReplaced,
}: ReplaceSpritesheetModalProps) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state when modal opens/closes or pet changes
  useEffect(() => {
    if (!open) {
      setSelectedFile(null);
      setPreviewUrl(null);
      setValidationError(null);
    }
  }, [open]);

  const handleFileSelect = async (file: File) => {
    setValidationError(null);
    setSelectedFile(file);
    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    // Validate dimensions
    const err = await validateSpritesheetFile(file);
    if (err) {
      setValidationError(err);
    }
  };

  const handleUpload = async () => {
    if (!pet || !selectedFile) return;
    if (validationError) {
      message.error(t(validationError));
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      const res = await fetch(
        `${PET_API_BASE}/pets/${encodeURIComponent(pet.folder)}/spritesheet`,
        { method: "POST", body: formData },
      );
      if (res.ok) {
        message.success(
          t("pet.spriteReplaceSuccess", "精灵图已替换").replace(
            "{name}",
            pet.displayName || pet.folder,
          ),
        );
        onReplaced();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.spriteReplaceFailed", "替换失败"));
      }
    } catch {
      message.error(t("pet.spriteReplaceFailed", "替换失败"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={t("pet.spriteReplaceTitle", "替换精灵图")}
      open={open}
      onCancel={onClose}
      onOk={handleUpload}
      okText={t("pet.spriteReplaceButton", "替换")}
      confirmLoading={uploading}
      okButtonProps={{ disabled: !selectedFile || !!validationError }}
      destroyOnHidden
      width={520}
    >
      {pet && (
        <div style={{ marginBottom: 16 }}>
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {t("pet.spriteReplaceFor", "宠物")}：
          </span>
          <strong>{pet.displayName || pet.folder}</strong>
          <code style={{ marginLeft: 8, fontSize: 12 }}>{pet.folder}</code>
        </div>
      )}

      <Alert
        type="info"
        showIcon
        icon={<PictureOutlined />}
        style={{ marginBottom: 16 }}
        message={t("pet.spriteSpecTitle", "精灵图规格要求")}
        description={
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <div>
              <strong>{t("pet.spriteSpecSize", "尺寸")}</strong>：{SPRITESHEET_SPEC.width} × {SPRITESHEET_SPEC.height} px
              <span style={{ color: "var(--ant-color-text-tertiary)", marginLeft: 8 }}>
                ({SPRITESHEET_SPEC.columns}列 × {SPRITESHEET_SPEC.rows}行，每帧 {SPRITESHEET_SPEC.cellWidth}×{SPRITESHEET_SPEC.cellHeight}px)
              </span>
            </div>
            <div>
              <strong>{t("pet.spriteSpecFormat", "格式")}</strong>：WebP / PNG / JPG
            </div>
            <div>
              <strong>{t("pet.spriteSpecLayout", "布局")}</strong>：
              {t("pet.spriteSpecLayoutDesc", "第0行=idle, 第1行=running-right, 第2行=running-left, 第3行=waving, 第4行=jumping, 第5行=failed, 第6行=waiting, 第7行=running, 第8行=review")}
            </div>
            <div style={{ marginTop: 4, color: "var(--ant-color-text-tertiary)" }}>
              {t("pet.spriteSpecTip", "提示：可使用 Aseprite、Piskel、LibreSprite 等像素艺术工具制作。原精灵图会自动备份为 spritesheet.bak.webp。")}
            </div>
          </div>
        }
      />

      <Upload.Dragger
        accept=".webp,.png,.jpg,.jpeg"
        maxCount={1}
        beforeUpload={(file: File) => {
          handleFileSelect(file);
          return false;
        }}
        onRemove={() => {
          setSelectedFile(null);
          setPreviewUrl(null);
          setValidationError(null);
        }}
      >
        <p className="ant-upload-drag-icon">
          <PictureOutlined />
        </p>
        <p className="ant-upload-text">
          {t("pet.spriteDropTitle", "拖放精灵图文件到此处")}
        </p>
        <p className="ant-upload-hint">
          {t("pet.spriteDropHint", "或点击选择 .webp / .png 文件")}
        </p>
      </Upload.Dragger>

      {validationError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message={t(validationError)}
        />
      )}

      {previewUrl && !validationError && (
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--ant-color-text-tertiary)", marginBottom: 8 }}>
            {t("pet.spritePreview", "预览（第0行第0帧）")}
          </div>
          <img
            src={previewUrl}
            alt="preview"
            style={{
              width: 192,
              height: 208,
              objectFit: "none",
              objectPosition: "0 0",
              imageRendering: "pixelated",
              borderRadius: 4,
              border: "1px solid var(--ant-color-border)",
            }}
          />
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Bind agent modal — link a pet to an enabled agent
// ---------------------------------------------------------------------------

interface BindAgentModalProps {
  open: boolean;
  pet: PetEntry | null;
  onClose: () => void;
  onBound: () => void;
}

function BindAgentModal({ open, pet, onClose, onBound }: BindAgentModalProps) {
  const { t } = useTranslation();
  const [agents, setAgents] = useState<AgentEntry[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load enabled agents every time the modal opens; reset selection.
  useEffect(() => {
    if (!open) {
      setSelectedAgentId(null);
      setAgents([]);
      return;
    }
    setSelectedAgentId(null);
    let cancelled = false;
    setAgentsLoading(true);
    fetch(`/api/agents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const list: AgentEntry[] = Array.isArray(data.agents) ? data.agents : [];
        // Only show enabled agents, per spec.
        setAgents(list.filter((a) => a.enabled !== false));
      })
      .catch(() => {
        if (!cancelled) setAgents([]);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const handleOk = async () => {
    if (!pet || !selectedAgent) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `${PET_API_BASE}/bindings/${encodeURIComponent(pet.folder)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: selectedAgent.id,
            agent_name: selectedAgent.name,
          }),
        },
      );
      if (res.ok) {
        message.success(t("pet.bindSuccess", "绑定成功"));
        onBound();
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.bindFailed", "绑定失败"));
      }
    } catch {
      message.error(t("pet.bindFailed", "绑定失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const petName = pet ? pet.displayName || pet.folder : "";

  return (
    <Modal
      title={t("pet.bindAgentTo", "绑定智能体到 {name}").replace(
        "{name}",
        petName,
      )}
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      okText={t("pet.bindAgentTitle", "绑定智能体")}
      confirmLoading={submitting}
      okButtonProps={{ disabled: !selectedAgent }}
      destroyOnHidden
      width={520}
    >
      {pet && (
        <div style={{ marginBottom: 12 }}>
          <span style={{ color: "var(--ant-color-text-secondary)", fontSize: 13 }}>
            {t("pet.colName", "名称")}：
          </span>
          <strong>{petName}</strong>
          <code style={{ marginLeft: 8, fontSize: 12 }}>{pet.folder}</code>
        </div>
      )}

      <div style={{ marginBottom: 8, fontSize: 13 }}>
        <RobotOutlined style={{ marginRight: 6, color: "var(--ant-color-text-secondary)" }} />
        {t("pet.selectAgent", "选择智能体")}
      </div>

      <Select
        style={{ width: "100%" }}
        loading={agentsLoading}
        value={selectedAgentId ?? undefined}
        onChange={(v: string) => setSelectedAgentId(v)}
        placeholder={t("pet.selectAgent", "选择智能体")}
        notFoundContent={t("pet.noAgents", "暂无可用智能体")}
        optionFilterProp="label"
        options={agents.map((a) => ({
          value: a.id,
          label: a.name,
          description: a.description || "",
        }))}
        optionRender={(option) => {
          const desc = option.data.description as string;
          return (
            <Space direction="vertical" size={0} style={{ padding: "2px 0" }}>
              <span style={{ lineHeight: 1.3 }}>{option.data.label as string}</span>
              {desc && (
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--ant-color-text-tertiary)",
                    lineHeight: 1.3,
                    maxWidth: 440,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                  title={desc}
                >
                  {desc}
                </span>
              )}
            </Space>
          );
        }}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pet chat modal — talk to the bound agent through the pet
// ---------------------------------------------------------------------------

interface ChatMsg {
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  toolName?: string;
  streaming?: boolean;
}

interface PetChatModalProps {
  open: boolean;
  pet: PetEntry | null;
  binding: PetBinding | null;
  onClose: () => void;
}

function PetChatModal({ open, pet, binding, onClose }: PetChatModalProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset messages when opening for a different pet
  useEffect(() => {
    if (open) {
      setMessages([]);
      setInput("");
      setThinking(false);
      setSending(false);
    }
    return () => {
      // Abort any in-flight SSE on close
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, [open, pet?.folder]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !pet || sending) return;
    if (!binding?.agent_id) {
      message.warning(t("pet.chatNoAgent", "请先绑定智能体"));
      return;
    }

    // Add user message
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setSending(true);
    setThinking(true);

    // Add a placeholder assistant message for streaming
    setMessages((prev) => [...prev, { role: "assistant", text: "", streaming: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${PET_API_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pet_id: pet.folder,
          message: text,
          session_id: binding.session_id,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${res.status}`);
      }

      // Read SSE stream via ReadableStream (POST + SSE, not EventSource)
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (!jsonStr) continue;

            try {
              const evt = JSON.parse(jsonStr);
              if (evt.type === "start") {
                // thinking state already set
              } else if (evt.type === "token") {
                setThinking(false);
                fullText += evt.text || "";
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant" && last.streaming) {
                    next[next.length - 1] = { ...last, text: fullText };
                  }
                  return next;
                });
              } else if (evt.type === "tool") {
                setThinking(false);
                fullText = ""; // reset for the new assistant response after tool
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  // If the last streaming assistant message has no text, remove it
                  if (last && last.role === "assistant" && last.streaming && !last.text) {
                    next.pop();
                  }
                  // Add tool notice and a new empty assistant placeholder
                  next.push({ role: "tool", text: "", toolName: evt.name });
                  next.push({ role: "assistant", text: "", streaming: true });
                  return next;
                });
              } else if (evt.type === "done") {
                setThinking(false);
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant" && last.streaming) {
                    next[next.length - 1] = {
                      ...last,
                      text: evt.text || fullText,
                      streaming: false,
                    };
                  }
                  return next;
                });
              } else if (evt.type === "error") {
                setThinking(false);
                setMessages((prev) => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last && last.role === "assistant" && last.streaming && !last.text) {
                    next.pop(); // remove empty placeholder
                  }
                  next.push({ role: "error", text: evt.message || "Unknown error" });
                  return next;
                });
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      }

      // Finalize: mark last streaming message as done
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.streaming) {
          next[next.length - 1] = { ...last, streaming: false };
        }
        return next;
      });
    } catch (err: any) {
      if (err.name === "AbortError") return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant" && last.streaming && !last.text) {
          next.pop();
        }
        next.push({
          role: "error",
          text: err.message || t("pet.chatError", "聊天出错"),
        });
        return next;
      });
    } finally {
      setSending(false);
      setThinking(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const petName = pet ? pet.displayName || pet.folder : "";
  const agentName = binding?.agent_name || binding?.agent_id || "";

  return (
    <Modal
      title={
        <Space>
          <MessageOutlined />
          {t("pet.chatTitle", "与 {name} 聊天").replace("{name}", petName)}
          {agentName && (
            <Tag icon={<RobotOutlined />} color="blue" style={{ marginInlineEnd: 0 }}>
              {agentName}
            </Tag>
          )}
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={560}
      styles={{ body: { padding: 0 } }}
    >
      <div className={styles.chatContainer}>
        <div className={styles.chatMessages} ref={scrollRef}>
          {messages.length === 0 && (
            <div className={styles.chatEmpty}>
              <RobotOutlined style={{ fontSize: 32, color: "var(--ant-color-text-quaternary)" }} />
              <p>{t("pet.chatPlaceholder", "发送消息开始与绑定的智能体对话")}</p>
            </div>
          )}
          {messages.map((msg, idx) => {
            if (msg.role === "user") {
              return (
                <div key={idx} className={styles.chatBubbleUser}>
                  <div className={styles.chatBubbleContent}>{msg.text}</div>
                </div>
              );
            }
            if (msg.role === "tool") {
              return (
                <div key={idx} className={styles.chatToolNotice}>
                  <ToolOutlined /> {t("pet.chatToolUsed", "使用工具")}: {msg.toolName}
                </div>
              );
            }
            if (msg.role === "error") {
              return (
                <div key={idx} className={styles.chatBubbleError}>
                  {msg.text}
                </div>
              );
            }
            // assistant
            return (
              <div key={idx} className={styles.chatBubbleAssistant}>
                <div className={styles.chatBubbleAvatar}>
                  <img
                    src={pet ? `${PET_API_BASE}/pets/${encodeURIComponent(pet.folder)}/spritesheet` : ""}
                    alt=""
                    style={{
                      width: 32,
                      height: 36,
                      objectFit: "none",
                      objectPosition: "0 0",
                      imageRendering: "pixelated",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div className={styles.chatBubbleContent}>
                  {msg.text || (msg.streaming && thinking ? (
                    <span className={styles.chatThinking}>
                      <LoadingOutlined /> {t("pet.chatThinking", "思考中…")}
                    </span>
                  ) : msg.streaming ? "…" : "")}
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.chatInputBar}>
          <Input.TextArea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("pet.chatInputPlaceholder", "输入消息，Enter 发送，Shift+Enter 换行")}
            autoSize={{ minRows: 1, maxRows: 4 }}
            disabled={sending}
            className={styles.chatInput}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={handleSend}
            loading={sending}
            disabled={!input.trim()}
          >
            {t("pet.chatSend", "发送")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PetPage() {
  const { t } = useTranslation();
  const [pets, setPets] = useState<PetEntry[]>([]);
  const [health, setHealth] = useState<DesktopHealth>({ running: false });
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [replaceSpriteOpen, setReplaceSpriteOpen] = useState(false);
  const [replaceSpritePet, setReplaceSpritePet] = useState<PetEntry | null>(null);
  // pet_id -> binding
  const [bindings, setBindings] = useState<Map<string, PetBinding>>(new Map());
  const [bindOpen, setBindOpen] = useState(false);
  const [bindPet, setBindPet] = useState<PetEntry | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPet, setChatPet] = useState<PetEntry | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${PET_API_BASE}/status`);
      if (res.ok) {
        const data: StatusResponse = await res.json();
        setHealth(data.desktop ?? { running: false });
      }
    } catch {
      setHealth({ running: false });
    }
  }, []);

  const fetchPets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${PET_API_BASE}/pets`);
      if (res.ok) {
        const data = await res.json();
        setPets(data.pets || []);
      }
    } catch {
      // ignore — table shows its own empty state
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch the pet→agent binding map. `GET /bindings` returns the full list;
  // we collapse it into a Map<pet_id, binding> for O(1) row lookups.
  const fetchBindings = useCallback(async () => {
    try {
      const res = await fetch(`${PET_API_BASE}/bindings`);
      if (res.ok) {
        const data = await res.json();
        const list: PetBinding[] = Array.isArray(data.bindings) ? data.bindings : [];
        const map = new Map<string, PetBinding>();
        for (const b of list) {
          if (b && b.pet_id) map.set(b.pet_id, b);
        }
        setBindings(map);
      }
    } catch {
      // ignore — bindings are optional, table still works without them
    }
  }, []);

  useEffect(() => {
    // Per spec: fetch bindings in parallel with pets.
    fetchPets();
    fetchBindings();
    fetchStatus();
  }, [fetchPets, fetchBindings, fetchStatus]);

  // Poll desktop status every 2s
  useEffect(() => {
    const id = setInterval(fetchStatus, 2000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  const handleStartDesktop = async () => {
    setStarting(true);
    try {
      const res = await fetch(`${PET_API_BASE}/desktop/start`, {
        method: "POST",
      });
      if (res.ok) {
        message.success(t("pet.desktopReady", "桌面宠物已就绪"));
        fetchStatus();
      } else {
        const data = await res.json().catch(() => ({}));
        if (data.detail === "already-running") {
          message.info(t("pet.desktopAlreadyRunning", "桌面宠物已在运行"));
        } else {
          message.error(t("pet.desktopStartFailed", "无法启动桌面宠物"));
        }
      }
    } catch {
      message.error(t("pet.desktopStartFailed", "无法启动桌面宠物"));
    } finally {
      setStarting(false);
    }
  };

  const handleSwitchPet = async (folder: string, petName: string) => {
    try {
      const res = await fetch(`${PET_API_BASE}/switch-pet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pet_dir: folder }),
      });
      if (res.ok) {
        message.success(
          t("pet.switchSuccess", "已切换至 {name}").replace("{name}", petName),
        );
        fetchStatus();
      } else {
        message.error(t("pet.switchFailed", "切换失败"));
      }
    } catch {
      message.error(t("pet.switchFailed", "切换失败"));
    }
  };

  const handleDeletePet = (record: PetEntry) => {
    const name = record.displayName || record.folder;
    Modal.confirm({
      title: t("pet.deleteConfirm", "删除宠物"),
      icon: <ExclamationCircleOutlined />,
      content: t(
        "pet.deleteConfirmText",
        "确定要删除宠物 {name} 吗？此操作不可恢复。",
      ).replace("{name}", name),
      okText: t("pet.deletePet", "删除"),
      okButtonProps: { danger: true },
      cancelText: t("pet.wizardCancel", "取消"),
      onOk: async () => {
        try {
          const res = await fetch(
            `${PET_API_BASE}/pets/${encodeURIComponent(record.folder)}`,
            { method: "DELETE" },
          );
          if (res.ok) {
            message.success(
              t("pet.deleteSuccess", "已删除 {name}").replace(
                "{name}",
                name,
              ),
            );
            fetchPets();
          } else {
            const data = await res.json().catch(() => ({}));
            message.error(
              data.detail || t("pet.deleteFailed", "删除失败"),
            );
          }
        } catch {
          message.error(t("pet.deleteFailed", "删除失败"));
        }
      },
    });
  };

  // Remove the agent binding for a pet. Called from the Popconfirm on the
  // "解绑" button; the confirm UI is rendered inline in the column.
  const handleUnbind = async (record: PetEntry) => {
    try {
      const res = await fetch(
        `${PET_API_BASE}/bindings/${encodeURIComponent(record.folder)}`,
        { method: "DELETE" },
      );
      if (res.ok) {
        message.success(t("pet.unbindSuccess", "已解绑"));
        fetchBindings();
      } else {
        const data = await res.json().catch(() => ({}));
        message.error(data.detail || t("pet.unbindFailed", "解绑失败"));
      }
    } catch {
      message.error(t("pet.unbindFailed", "解绑失败"));
    }
  };

  const columns = [
    {
      title: t("pet.colPreview", "预览"),
      key: "preview",
      width: 120,
      render: (_: unknown, record: PetEntry) => (
        <img
          src={`${PET_API_BASE}/pets/${encodeURIComponent(record.folder)}/spritesheet`}
          alt={record.displayName}
          style={{
            width: 96,
            height: 104,
            objectFit: "none",
            objectPosition: "0 0",
            imageRendering: "pixelated",
            borderRadius: 4,
            background: "var(--ant-color-fill-tertiary)",
          }}
        />
      ),
    },
    {
      title: t("pet.colName", "名称"),
      dataIndex: "displayName",
      key: "displayName",
      ellipsis: true,
      render: (v: string) => v || <span style={{ color: "var(--ant-color-text-tertiary)" }}>-</span>,
    },
    {
      title: t("pet.colFolder", "文件夹"),
      dataIndex: "folder",
      key: "folder",
      ellipsis: true,
      render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
    },
    {
      title: "pet.json id",
      key: "manifestId",
      ellipsis: true,
      render: (_: unknown, record: PetEntry) =>
        record.manifestId || record.id || (
          <span style={{ color: "var(--ant-color-text-tertiary)" }}>-</span>
        ),
    },
    {
      title: t("pet.colAgent", "智能体"),
      key: "agent",
      width: 280,
      render: (_: unknown, record: PetEntry) => {
        const binding = bindings.get(record.folder);
        if (binding) {
          return (
            <Space size={4} wrap>
              <Tag
                icon={<LinkOutlined />}
                color="blue"
                style={{ marginInlineEnd: 0 }}
              >
                {binding.agent_name || binding.agent_id}
              </Tag>
              <Tooltip title={t("pet.chatWithPet", "与宠物聊天")}>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<MessageOutlined />}
                  onClick={() => {
                    setChatPet(record);
                    setChatOpen(true);
                  }}
                >
                  {t("pet.chat", "聊天")}
                </Button>
              </Tooltip>
              <Popconfirm
                title={t("pet.unbindConfirm", "确定解绑此智能体？")}
                okText={t("pet.unbindAgent", "解绑")}
                okButtonProps={{ danger: true }}
                cancelText={t("pet.wizardCancel", "取消")}
                onConfirm={() => handleUnbind(record)}
              >
                <Tooltip title={t("pet.unbindAgent", "解绑")}>
                  <Button
                    size="small"
                    icon={<DisconnectOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </Space>
          );
        }
        return (
          <Button
            size="small"
            icon={<RobotOutlined />}
            onClick={() => {
              setBindPet(record);
              setBindOpen(true);
            }}
          >
            {t("pet.bindAgent", "绑定")}
          </Button>
        );
      },
    },
    {
      title: t("pet.colAction", "操作"),
      key: "action",
      width: 200,
      render: (_: unknown, record: PetEntry) => (
        <Space>
          <Button
            size="small"
            type="primary"
            ghost
            onClick={() =>
              handleSwitchPet(record.folder, record.displayName || record.folder)
            }
          >
            {t("pet.switch", "切换")}
          </Button>
          <Tooltip title={t("pet.replaceSprite", "替换精灵图")}>
            <Button
              size="small"
              icon={<SwapOutlined />}
              onClick={() => {
                setReplaceSpritePet(record);
                setReplaceSpriteOpen(true);
              }}
            />
          </Tooltip>
          <Tooltip title={t("pet.deletePet", "删除")}>
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => handleDeletePet(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        current={t("pet.title", "桌面宠物")}
        subRow={
          <div
            style={{
              color: "var(--ant-color-text-secondary)",
              fontSize: 13,
            }}
          >
            {t(
              "pet.intro",
              "管理 AIArb 桌面宠物，支持启动、切换、创建与导入。",
            )}
          </div>
        }
      />

      <Card title={t("pet.control", "控制面板")} className={styles.card}>
        <Space>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={handleStartDesktop}
            loading={starting}
          >
            {t("pet.startDesktop", "启动桌面宠物")}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchPets}>
            {t("pet.refresh", "刷新")}
          </Button>
        </Space>
        <div className={styles.statusBar}>
          <span>{t("pet.desktopHealth", "桌面服务状态：")}</span>
          <Tag color={health.running ? "green" : "default"}>
            {health.running
              ? t("pet.desktopRunning", "运行中")
              : t("pet.desktopStopped", "未运行")}
          </Tag>
          {health.running && health.port ? (
            <span
              style={{
                fontSize: 12,
                color: "var(--ant-color-text-tertiary)",
              }}
            >
              port {health.port}
            </span>
          ) : null}
        </div>
      </Card>

      <Card
        title={t("pet.installedPets", "已安装宠物")}
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              onClick={() => setWizardOpen(true)}
            >
              {t("pet.createPet", "创建宠物")}
            </Button>
            <Tooltip
              title={t(
                "pet.advancedImportHint",
                "高级选项：从本地 .zip 文件导入已有宠物",
              )}
            >
              <Button
                size="small"
                icon={<UploadOutlined />}
                onClick={() => setImportOpen(true)}
              >
                {t("pet.advancedImport", "从文件导入 (.zip)")}
              </Button>
            </Tooltip>
          </Space>
        }
        className={styles.card}
      >
        {loading ? (
          <div style={{ textAlign: "center", padding: 40 }}>
            <Spinner />
          </div>
        ) : (
          <Table
            dataSource={pets}
            columns={columns}
            rowKey="folder"
            pagination={false}
            locale={{ emptyText: t("pet.tableEmpty", "暂无已安装的宠物") }}
          />
        )}
      </Card>

      <CreatePetWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onCreated={fetchPets}
      />
      <AdvancedImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={fetchPets}
      />

      {/* Replace spritesheet modal — upload custom pixel-art */}
      <ReplaceSpritesheetModal
        open={replaceSpriteOpen}
        pet={replaceSpritePet}
        onClose={() => setReplaceSpriteOpen(false)}
        onReplaced={fetchPets}
      />

      {/* Bind agent modal — link a pet to an enabled agent */}
      <BindAgentModal
        open={bindOpen}
        pet={bindPet}
        onClose={() => setBindOpen(false)}
        onBound={fetchBindings}
      />

      {/* Pet chat modal — talk to the bound agent through the pet */}
      <PetChatModal
        open={chatOpen}
        pet={chatPet}
        binding={chatPet ? bindings.get(chatPet.folder) ?? null : null}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
