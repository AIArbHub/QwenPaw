import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { RcFile } from "antd/es/upload/interface";
import {
  Button,
  Collapse,
  Drawer,
  Input,
  List,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Tag,
  Upload,
} from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  InboxOutlined,
  LoadingOutlined,
  RocketOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import {
  kbCuratorApi,
  knowledgeApi,
  type CurateTaskItem,
  type CuratorSettings,
  type KnowledgeCategory,
} from "../../api/modules/knowledge";
import { useAppMessage } from "../../hooks/useAppMessage";
import styles from "./CuratorPanel.module.less";

const { Dragger } = Upload;

interface CuratorPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called when a curation task finishes while the panel is open. */
  onTaskCompleted?: () => void;
}

const CATEGORY_OPTIONS = ["laws", "rules", "cases", "templates"];

function formatTime(ts: number | null): string {
  if (!ts) return "-";
  return dayjs(ts * 1000).format("MM-DD HH:mm");
}

const STATUS_META: Record<
  CurateTaskItem["status"],
  { color: string; icon: ReactNode }
> = {
  pending: { color: "default", icon: <ClockCircleOutlined /> },
  running: { color: "processing", icon: <LoadingOutlined /> },
  done: { color: "success", icon: <CheckCircleOutlined /> },
  error: { color: "error", icon: <ClockCircleOutlined /> },
};

export default function CuratorPanel({ open, onClose, onTaskCompleted }: CuratorPanelProps) {
  const { t } = useTranslation();
  const { message } = useAppMessage();

  const [settings, setSettings] = useState<CuratorSettings | null>(null);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);

  // 提交表单
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("");
  const [text, setText] = useState("");
  const [fileList, setFileList] = useState<RcFile[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // 任务列表
  const [tasks, setTasks] = useState<CurateTaskItem[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevTaskStatuses = useRef<Map<string, string>>(new Map());

  const loadSettings = useCallback(async () => {
    try {
      const data = await kbCuratorApi.getSettings();
      setSettings(data);
    } catch {
      // settings are optional; ignore read failures
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const overview = await knowledgeApi.overview();
      setCategories(overview.categories);
    } catch {
      setCategories([]);
    }
  }, []);

  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) setLoadingTasks(true);
    try {
      const data = await kbCuratorApi.listTasks();
      // Detect tasks that just transitioned to "done" or "error"
      let completed = false;
      for (const task of data.tasks) {
        const prev = prevTaskStatuses.current.get(task.id);
        if (prev && prev !== task.status && (task.status === "done" || task.status === "error")) {
          completed = true;
        }
        prevTaskStatuses.current.set(task.id, task.status);
      }
      if (completed && onTaskCompleted) {
        onTaskCompleted();
      }
      setTasks(data.tasks);
    } catch {
      // ignore transient failures; next poll will retry
    } finally {
      if (!silent) setLoadingTasks(false);
    }
  }, [onTaskCompleted]);

  // Open 时加载设置、分类与任务列表
  useEffect(() => {
    if (!open) return;
    loadSettings();
    loadCategories();
    loadTasks();
  }, [open, loadSettings, loadCategories, loadTasks]);

  // 存在进行中的任务时轮询刷新
  useEffect(() => {
    if (!open) return;
    const hasActive = tasks.some(
      (task) => task.status === "pending" || task.status === "running",
    );
    if (hasActive) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => loadTasks(true), 3000);
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, tasks, loadTasks]);

  const handleSaveSettings = async (patch: Partial<CuratorSettings>) => {
    try {
      const updated = await kbCuratorApi.updateSettings(patch);
      setSettings(updated);
      message.success(t("knowledge.curator.settingsSaved", "设置已保存"));
    } catch (err) {
      message.error(t("knowledge.curator.settingsFailed", "设置保存失败"));
    }
  };

  const handleSubmit = async () => {
    if (!text.trim() && fileList.length === 0) {
      message.warning(
        t("knowledge.curator.textRequired", "请输入素材内容或上传文件"),
      );
      return;
    }
    setSubmitting(true);
    try {
      if (fileList.length > 0) {
        await kbCuratorApi.curateUpload(fileList, title, category);
      } else {
        await kbCuratorApi.curateText({ text, title, category });
      }
      message.success(t("knowledge.curator.submitSuccess", "已提交整理任务"));
      setText("");
      setFileList([]);
      setTitle("");
      loadTasks();
    } catch (err) {
      message.error(t("knowledge.curator.submitFailed", "提交失败，请重试"));
    } finally {
      setSubmitting(false);
    }
  };

  const activeCount = tasks.filter(
    (task) => task.status === "pending" || task.status === "running",
  ).length;

  return (
    <Drawer
      title={
        <Space size={8}>
          <RocketOutlined />
          <span>{t("knowledge.curator.title", "AI 知识整理")}</span>
          {activeCount > 0 && (
            <Tag color="processing" icon={<LoadingOutlined />}>
              {activeCount}
            </Tag>
          )}
        </Space>
      }
      open={open}
      onClose={onClose}
      width={480}
      destroyOnClose
    >
      <Tabs
        defaultActiveKey="submit"
        items={[
          {
            key: "submit",
            label: t("knowledge.curator.materialTab", "提交素材"),
            children: (
              <div className={styles.submitPanel}>
                <Input
                  placeholder={t(
                    "knowledge.curator.titlePlaceholder",
                    "素材标题（可选）",
                  )}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
                <Select
                  placeholder={t(
                    "knowledge.curator.categoryAuto",
                    "目标分类（默认由 AI 自动判断）",
                  )}
                  value={category || undefined}
                  onChange={setCategory}
                  allowClear
                  options={[
                    ...CATEGORY_OPTIONS.map((c) => ({
                      label: c,
                      value: c,
                    })),
                    ...categories.map((c) => ({
                      label: c.name,
                      value: c.name,
                    })),
                  ]}
                  style={{ width: "100%" }}
                />
                <Input.TextArea
                  placeholder={t(
                    "knowledge.curator.textPlaceholder",
                    "粘贴需要整理的文本内容…",
                  )}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  autoSize={{ minRows: 6, maxRows: 14 }}
                  style={{ whiteSpace: "pre-wrap" }}
                />
                <Dragger
                  multiple
                  beforeUpload={(file) => {
                    setFileList((prev) => {
                      if (prev.some((f) => f.name === file.name)) return prev;
                      return [...prev, file];
                    });
                    return false;
                  }}
                  onRemove={(file) => {
                    setFileList((prev) =>
                      prev.filter((f) => f.name !== file.name),
                    );
                  }}
                  fileList={fileList.map((f) => ({
                    uid: f.name,
                    name: f.name,
                    status: "done" as const,
                    size: f.size,
                    originFileObj: f,
                  }))}
                >
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">
                    {t(
                      "knowledge.curator.uploadHint",
                      "点击或拖拽文件上传（支持多文件）",
                    )}
                  </p>
                </Dragger>
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  loading={submitting}
                  onClick={handleSubmit}
                  block
                >
                  {t("knowledge.curator.submit", "开始整理")}
                </Button>

                <Collapse
                  ghost
                  items={[
                    {
                      key: "settings",
                      label: t(
                        "knowledge.curator.settingsTitle",
                        "整理设置（可选）",
                      ),
                      children: (
                        <div className={styles.settingsPanel}>
                          <div className={styles.settingRow}>
                            <span>
                              {t(
                                "knowledge.curator.enabled",
                                "启用 AI 整理",
                              )}
                            </span>
                            <Switch
                              size="small"
                              checked={settings?.enabled ?? true}
                              onChange={(checked) =>
                                handleSaveSettings({ enabled: checked })
                              }
                            />
                          </div>
                          <div className={styles.settingRow}>
                            <span>
                              {t(
                                "knowledge.curator.publishEnabled",
                                "整理后自动发布到知识库",
                              )}
                            </span>
                            <Switch
                              size="small"
                              checked={settings?.publish_enabled ?? true}
                              onChange={(checked) =>
                                handleSaveSettings({ publish_enabled: checked })
                              }
                            />
                          </div>
                          <div className={styles.settingRow}>
                            <span>
                              {t(
                                "knowledge.curator.defaultCategory",
                                "默认分类",
                              )}
                            </span>
                            <Select
                              size="small"
                              allowClear
                              placeholder={t(
                                "knowledge.curator.categoryAuto",
                                "由 AI 自动判断",
                              )}
                              value={settings?.default_category || undefined}
                              onChange={(value) =>
                                handleSaveSettings({
                                  default_category: value || "",
                                })
                              }
                              style={{ width: 160 }}
                              options={CATEGORY_OPTIONS.map((c) => ({
                                label: c,
                                value: c,
                              }))}
                            />
                          </div>
                          <div className={styles.settingRow}>
                            <span>
                              {t(
                                "knowledge.curator.timeout",
                                "单次整理超时（分钟）",
                              )}
                            </span>
                            <Input
                              size="small"
                              type="number"
                              min={2}
                              max={60}
                              value={
                                settings
                                  ? Math.round(
                                      (settings.timeout_seconds || 600) / 60,
                                    )
                                  : 10
                              }
                              onChange={(e) => {
                                const minutes = Number(e.target.value);
                                if (Number.isFinite(minutes) && minutes >= 2) {
                                  handleSaveSettings({
                                    timeout_seconds: minutes * 60,
                                  });
                                }
                              }}
                              style={{ width: 90 }}
                            />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            ),
          },
          {
            key: "records",
            label: t("knowledge.curator.recordsTab", "整理记录"),
            children: (
              <div className={styles.recordsPanel}>
                <Spin spinning={loadingTasks}>
                  <List
                    dataSource={tasks}
                    locale={{
                      emptyText: t(
                        "knowledge.curator.noTasks",
                        "暂无整理记录",
                      ),
                    }}
                    renderItem={(task) => {
                      const meta = STATUS_META[task.status];
                      return (
                        <List.Item className={styles.taskItem}>
                          <div className={styles.taskHeader}>
                            <span className={styles.taskTitle}>
                              {task.title}
                            </span>
                            <Tag color={meta.color} icon={meta.icon}>
                              {t(
                                `knowledge.curator.task_${task.status}`,
                                task.status,
                              )}
                            </Tag>
                          </div>
                          <div className={styles.taskMeta}>
                            {task.category && (
                              <span className={styles.taskCategory}>
                                {task.category}
                              </span>
                            )}
                            {task.file_names.length > 0 && (
                              <span>
                                {task.file_names.length} 个文件
                              </span>
                            )}
                            <span>{formatTime(task.created_at)}</span>
                          </div>
                          {task.status === "done" &&
                            task.published.length > 0 && (
                              <div className={styles.publishedList}>
                                {task.published.some((p) => !p.published) ? (
                                  <div className={styles.publishedHint}>
                                    {t(
                                      "knowledge.curator.publishedDisabled",
                                      "未发布（已关闭自动发布）",
                                    )}
                                  </div>
                                ) : (
                                  <>
                                    <div className={styles.publishedLabel}>
                                      {t(
                                        "knowledge.curator.publishedFiles",
                                        "已发布到知识库",
                                      )}
                                    </div>
                                    {task.published.map((p) => (
                                      <div
                                        key={p.path}
                                        className={styles.publishedPath}
                                      >
                                        {p.category}/{p.name}
                                      </div>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          {task.status === "done" &&
                            task.published.length === 0 && (
                              <div className={styles.publishedHint}>
                                {t(
                                  "knowledge.curator.noPublishedFiles",
                                  "整理完成，但未生成可发布的文档（智能体可能未正确写入产物）",
                                )}
                              </div>
                            )}
                          {task.status === "error" && task.error && (
                            <div className={styles.taskError}>{task.error}</div>
                          )}
                        </List.Item>
                      );
                    }}
                  />
                </Spin>
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
