import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Button,
  Card,
  Dropdown,
  Form,
  Modal,
  Select,
  Table,
} from "@agentscope-ai/design";
import { MoreOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type {
  CronDispatchTargetItem,
  CronJobExecutionRecord,
  CronJobSpecOutput,
} from "../../../api/types";
import { useTranslation } from "react-i18next";
import api from "../../../api";
import {
  createColumns,
  JobDrawer,
  TemplatePickerModal,
  useCronJobs,
  DEFAULT_FORM_VALUES,
} from "./components";
import { parseCron, serializeCron } from "./components/parseCron";
import styles from "./index.module.less";

type CronJob = CronJobSpecOutput;
type ScheduleTypeFilter = "all" | "cron" | "once";

dayjs.extend(utc);
dayjs.extend(timezone);

interface CronJobListContentProps {
  /** Agent ID — the underlying useCronJobs hook already reads from agentStore. */
  agentId: string;
  /** When true, render the filter + create buttons toolbar. */
  showHeader?: boolean;
}

/**
 * CronJobListContent — extracted list view from CronJobsPage.
 *
 * Contains: optional toolbar (filter + create/template buttons), Table (desktop)
 * / Card list (mobile), JobDrawer, TemplatePickerModal, and execution history Modal.
 *
 * The calendar view and view-toggle remain exclusively in CronJobsPage.
 *
 * Used by:
 *  - WorkbenchPage "定时任务" tab
 */
const CronJobListContent: React.FC<CronJobListContentProps> = ({
  showHeader = true,
}) => {
  const { t } = useTranslation();
  const {
    jobs,
    loading,
    createJob,
    updateJob,
    deleteJob,
    toggleEnabled,
    executeNow,
  } = useCronJobs();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [saving, setSaving] = useState(false);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  const [scheduleTypeFilter, setScheduleTypeFilter] =
    useState<ScheduleTypeFilter>("all");
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<
    CronJobExecutionRecord[]
  >([]);
  const [historyJobName, setHistoryJobName] = useState("");
  const [expandedHistoryErrors, setExpandedHistoryErrors] = useState<
    Set<string>
  >(new Set());
  const [userTimezone, setUserTimezone] = useState("UTC");
  const [form] = Form.useForm<CronJob>();
  const userTimezoneRef = useRef("UTC");
  const [targetItems, setTargetItems] = useState<CronDispatchTargetItem[]>([]);
  const [targetChannels, setTargetChannels] = useState<string[]>(["console"]);
  const [targetsLoading, setTargetsLoading] = useState(false);

  useEffect(() => {
    api
      .getUserTimezone()
      .then((res) => {
        if (res.timezone) {
          userTimezoneRef.current = res.timezone;
          setUserTimezone(res.timezone);
        }
      })
      .catch((err) => console.error("Failed to fetch user timezone:", err));
  }, []);

  const loadDispatchTargets = useCallback(async () => {
    setTargetsLoading(true);
    try {
      const res = await api.listCronDispatchTargets();
      setTargetItems(res?.items || []);
      setTargetChannels(res?.channels?.length ? res.channels : ["console"]);
    } catch (error) {
      console.error("Failed to fetch cron dispatch targets", error);
      setTargetItems([]);
      setTargetChannels(["console"]);
    } finally {
      setTargetsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDispatchTargets();
  }, [loadDispatchTargets]);

  const handleCreate = () => {
    setEditingJob(null);
    form.resetFields();
    form.setFieldsValue({
      ...DEFAULT_FORM_VALUES,
      schedule: {
        ...DEFAULT_FORM_VALUES.schedule,
        timezone: userTimezoneRef.current,
      },
    });
    setDrawerOpen(true);
  };

  const handleOpenTemplateModal = () => {
    setTemplateModalOpen(true);
  };

  const handleUseTemplate = (templateValues: Record<string, unknown>) => {
    setTemplateModalOpen(false);
    setEditingJob(null);
    form.resetFields();
    form.setFieldsValue({
      ...DEFAULT_FORM_VALUES,
      schedule: {
        ...DEFAULT_FORM_VALUES.schedule,
        timezone: userTimezoneRef.current,
      },
      ...templateValues,
    });
    setDrawerOpen(true);
  };

  const formatSchedule = (job: CronJob) => {
    if (job.schedule?.type === "once") {
      return job.schedule?.run_at
        ? dayjs(job.schedule.run_at).format("YYYY-MM-DD HH:mm")
        : "-";
    }
    const cron = job.schedule?.cron || "-";
    const parts = parseCron(cron);
    switch (parts.type) {
      case "hourly":
        return t("cronJobs.cronTypeHourly");
      case "daily":
        return `${t("cronJobs.cronTypeDaily")} ${String(parts.hour).padStart(
          2,
          "0",
        )}:${String(parts.minute).padStart(2, "0")}`;
      case "weekly": {
        const dayNames = (parts.daysOfWeek || [])
          .map((d) => {
            const dayMap: Record<string, string> = {
              mon: t("cronJobs.cronDayMon"),
              tue: t("cronJobs.cronDayTue"),
              wed: t("cronJobs.cronDayWed"),
              thu: t("cronJobs.cronDayThu"),
              fri: t("cronJobs.cronDayFri"),
              sat: t("cronJobs.cronDaySat"),
              sun: t("cronJobs.cronDaySun"),
            };
            return dayMap[d] || d;
          })
          .join(",");
        return `${t("cronJobs.cronTypeWeekly")} ${dayNames}`;
      }
      default:
        return cron;
    }
  };

  const handleEdit = (job: CronJob) => {
    setEditingJob(job);

    const formValues: any = {
      ...job,
      request: {
        ...job.request,
        input: job.request?.input
          ? JSON.stringify(job.request.input, null, 2)
          : "",
      },
      scheduleType: job.schedule?.type || "cron",
    };

    if (job.schedule?.type === "once") {
      formValues.onceRunAt = job.schedule.run_at
        ? dayjs(job.schedule.run_at)
        : null;
      formValues.onceRepeatEnabled = Boolean(job.schedule.repeat_every_days);
      formValues.onceRepeatEveryDays = job.schedule.repeat_every_days || 1;
      formValues.onceRepeatEndType = job.schedule.repeat_end_type || "never";
      formValues.onceRepeatUntil = job.schedule.repeat_until
        ? dayjs(job.schedule.repeat_until)
        : null;
      formValues.onceRepeatCount = job.schedule.repeat_count || 2;
    } else {
      const cronParts = parseCron(job.schedule?.cron || "0 9 * * *");
      formValues.cronType = cronParts.type;

      if (cronParts.type === "daily" || cronParts.type === "weekly") {
        const h = cronParts.hour ?? 9;
        const m = cronParts.minute ?? 0;
        formValues.cronTime = dayjs().hour(h).minute(m);
      }

      if (cronParts.type === "weekly" && cronParts.daysOfWeek) {
        formValues.cronDaysOfWeek = cronParts.daysOfWeek;
      }

      if (cronParts.type === "custom" && cronParts.rawCron) {
        formValues.cronCustom = cronParts.rawCron;
      }
    }

    form.setFieldsValue(formValues);
    setDrawerOpen(true);
  };

  const handleDelete = (jobId: string) => {
    Modal.confirm({
      title: t("cronJobs.confirmDelete"),
      content: t("cronJobs.deleteConfirm"),
      okText: t("cronJobs.deleteText"),
      okType: "primary",
      cancelText: t("cronJobs.cancelText"),
      onOk: async () => {
        await deleteJob(jobId);
      },
    });
  };

  const handleToggleEnabled = async (job: CronJob) => {
    await toggleEnabled(job);
  };

  const handleExecuteNow = async (job: CronJob) => {
    Modal.confirm({
      title: t("cronJobs.executeNowTitle"),
      content: t("cronJobs.executeNowContent", { name: job.name }),
      okText: t("cronJobs.executeNowConfirm"),
      okType: "primary",
      cancelText: t("cronJobs.cancelText"),
      onOk: async () => {
        await executeNow(job.id);
      },
    });
  };

  const handleDrawerClose = () => {
    setDrawerOpen(false);
    setEditingJob(null);
  };

  const handleViewHistory = async (job: CronJob) => {
    setHistoryJobName(job.name);
    setHistoryModalOpen(true);
    setExpandedHistoryErrors(new Set());
    setHistoryLoading(true);
    try {
      const records = await api.getCronJobHistory(job.id);
      setHistoryRecords(records || []);
    } catch (error) {
      console.error("Failed to fetch cron history", error);
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSubmit = async (values: any) => {
    let schedule: any = values.schedule || {};
    if ((values.scheduleType || "cron") === "once") {
      const onceRepeatEnabled = Boolean(values.onceRepeatEnabled);
      const repeatEndType = values.onceRepeatEndType || "never";
      schedule = {
        type: "once",
        run_at: values.onceRunAt
          ? dayjs(values.onceRunAt).format("YYYY-MM-DDTHH:mm:00")
          : undefined,
        timezone: values.schedule?.timezone || userTimezoneRef.current,
        repeat_every_days: onceRepeatEnabled
          ? Number(values.onceRepeatEveryDays || 1)
          : undefined,
        repeat_end_type: onceRepeatEnabled ? repeatEndType : undefined,
        repeat_until:
          onceRepeatEnabled &&
          repeatEndType === "until" &&
          values.onceRepeatUntil
            ? dayjs(values.onceRepeatUntil).format("YYYY-MM-DDTHH:mm:00")
            : undefined,
        repeat_count:
          onceRepeatEnabled && repeatEndType === "count"
            ? Number(values.onceRepeatCount || 1)
            : undefined,
      };
    } else {
      const cronParts: any = {
        type: values.cronType || "daily",
      };

      if (values.cronType === "daily" || values.cronType === "weekly") {
        if (values.cronTime) {
          cronParts.hour = values.cronTime.hour();
          cronParts.minute = values.cronTime.minute();
        }
      }

      if (values.cronType === "weekly" && values.cronDaysOfWeek) {
        cronParts.daysOfWeek = values.cronDaysOfWeek;
      }

      if (values.cronType === "custom" && values.cronCustom) {
        cronParts.rawCron = values.cronCustom;
      }

      schedule = {
        ...values.schedule,
        type: "cron",
        cron: serializeCron(cronParts),
      };
    }

    let processedValues = {
      ...values,
      schedule,
    };
    delete processedValues.scheduleType;
    delete processedValues.onceRunAt;
    delete processedValues.onceRepeatEnabled;
    delete processedValues.onceRepeatEveryDays;
    delete processedValues.onceRepeatEndType;
    delete processedValues.onceRepeatUntil;
    delete processedValues.onceRepeatCount;
    delete processedValues.cronType;
    delete processedValues.cronTime;
    delete processedValues.cronDaysOfWeek;
    delete processedValues.cronCustom;

    if (processedValues.task_type === "text") {
      delete processedValues.request;
    } else if (processedValues.task_type === "agent") {
      if (!processedValues.request) {
        processedValues.request = {};
      }

      if (
        processedValues.request?.input &&
        typeof processedValues.request.input === "string"
      ) {
        try {
          processedValues.request.input = JSON.parse(
            processedValues.request.input,
          );
        } catch (error) {
          console.error("❌ Failed to parse request.input JSON:", error);
        }
      }
    }

    let success = false;
    setSaving(true);
    try {
      if (editingJob) {
        success = await updateJob(editingJob.id, processedValues);
      } else {
        success = await createJob(processedValues);
      }
    } finally {
      setSaving(false);
    }
    if (success) {
      setDrawerOpen(false);
    }
  };

  const columns = createColumns({
    onToggleEnabled: handleToggleEnabled,
    onExecuteNow: handleExecuteNow,
    onViewHistory: handleViewHistory,
    onEdit: handleEdit,
    onDelete: handleDelete,
    t,
  });

  const HISTORY_ERROR_PREVIEW_LINES = 4;
  const HISTORY_ERROR_PREVIEW_CHARS = 280;

  const shouldShowErrorToggle = (errorText: string) => {
    const lineCount = errorText.split("\n").length;
    return (
      lineCount > HISTORY_ERROR_PREVIEW_LINES ||
      errorText.length > HISTORY_ERROR_PREVIEW_CHARS
    );
  };

  const toggleHistoryError = (recordKey: string) => {
    setExpandedHistoryErrors((prev) => {
      const next = new Set(prev);
      if (next.has(recordKey)) {
        next.delete(recordKey);
      } else {
        next.add(recordKey);
      }
      return next;
    });
  };

  const filteredListJobs = useMemo(() => {
    if (scheduleTypeFilter === "all") return jobs;
    return jobs.filter((job) => job.schedule?.type === scheduleTypeFilter);
  }, [jobs, scheduleTypeFilter]);

  return (
    <div className={styles.cronJobsPage}>
      {showHeader && (
        <div className={styles.headerActions}>
          <Select<ScheduleTypeFilter>
            value={scheduleTypeFilter}
            onChange={setScheduleTypeFilter}
            style={
              isMobile ? { width: "100%", maxWidth: 160 } : { width: 200 }
            }
            options={[
              {
                label: t("cronJobs.scheduleFilterAll"),
                value: "all",
              },
              {
                label: t("cronJobs.scheduleTypeRecurring"),
                value: "cron",
              },
              {
                label: t("cronJobs.scheduleTypeOnce"),
                value: "once",
              },
            ]}
          />
          {!isMobile && (
            <Button type="primary" onClick={handleCreate}>
              + {t("cronJobs.createJob")}
            </Button>
          )}
          {isMobile && (
            <Button type="primary" onClick={handleCreate} size="small">
              +
            </Button>
          )}
          {!isMobile && (
            <Button onClick={handleOpenTemplateModal}>
              {t("cronJobs.createFromTemplate")}
            </Button>
          )}
        </div>
      )}

      {isMobile ? (
        <div className={styles.mobileCardList}>
          {filteredListJobs.map((job) => (
            <Card
              key={job.id}
              className={styles.mobileJobCard}
              size="small"
              styles={{ body: { padding: 24 } }}
            >
              <div className={styles.mobileJobHeader}>
                <span className={styles.mobileJobName}>{job.name}</span>
                <span
                  className={`${styles.mobileJobStatus} ${
                    job.enabled ? styles.enabled : ""
                  }`}
                >
                  <span
                    className={`${styles.statusDot} ${
                      job.enabled ? styles.enabled : styles.disabled
                    }`}
                  />
                  {job.enabled ? t("common.enabled") : t("common.disabled")}
                </span>
              </div>
              <div className={styles.mobileJobSchedule}>
                {formatSchedule(job)}
              </div>
              <div className={styles.mobileJobActions}>
                <Button
                  size="small"
                  className={styles.mobileActionBtn}
                  onClick={() => toggleEnabled(job)}
                >
                  {job.enabled ? t("cronJobs.disable") : t("common.enable")}
                </Button>
                <Button
                  size="small"
                  className={styles.mobileActionBtn}
                  onClick={() => executeNow(job.id as string)}
                >
                  {t("cronJobs.executeNow")}
                </Button>
                <Button
                  size="small"
                  className={styles.mobileActionBtn}
                  onClick={() => handleViewHistory(job)}
                >
                  {t("cronJobs.executionHistory")}
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: "edit",
                        label: t("cronJobs.edit"),
                        onClick: () => handleEdit(job),
                      },
                      {
                        key: "delete",
                        label: t("cronJobs.delete"),
                        danger: true,
                        onClick: () => handleDelete(job.id as string),
                      },
                    ],
                  }}
                  placement="bottomRight"
                >
                  <Button
                    type="text"
                    size="small"
                    className={styles.mobileMoreBtn}
                    icon={<MoreOutlined />}
                  />
                </Dropdown>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card className={styles.tableCard} styles={{ body: { padding: 0 } }}>
          <Table
            columns={columns}
            dataSource={filteredListJobs}
            loading={loading}
            rowKey="id"
            scroll={{ x: 2840 }}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
            }}
          />
        </Card>
      )}

      <JobDrawer
        open={drawerOpen}
        editingJob={editingJob}
        form={form}
        saving={saving}
        targetItems={targetItems}
        targetChannels={targetChannels}
        targetsLoading={targetsLoading}
        onReloadTargets={loadDispatchTargets}
        onClose={handleDrawerClose}
        onSubmit={handleSubmit}
      />

      <TemplatePickerModal
        open={templateModalOpen}
        timezone={userTimezoneRef.current}
        onCancel={() => setTemplateModalOpen(false)}
        onUseTemplate={handleUseTemplate}
      />

      <Modal
        open={historyModalOpen}
        title={t("cronJobs.historyTitle", { name: historyJobName })}
        footer={null}
        onCancel={() => setHistoryModalOpen(false)}
      >
        <div className={styles.historyList}>
          {historyLoading ? (
            <div className={styles.historyEmpty}>{t("common.loading")}</div>
          ) : historyRecords.length === 0 ? (
            <div className={styles.historyEmpty}>
              {t("cronJobs.historyEmpty")}
            </div>
          ) : (
            historyRecords.map((record, index) => (
              <div
                key={`${record.run_at}-${index}`}
                className={styles.historyItem}
              >
                <div className={styles.historyItemMain}>
                  <span className={styles.historyItemTime}>
                    {dayjs(record.run_at)
                      .tz(userTimezone)
                      .format("YYYY-MM-DD HH:mm:ss")}
                  </span>
                  <span
                    className={`${styles.historyItemStatus} ${
                      record.status === "success"
                        ? styles.historyItemStatusSuccess
                        : styles.historyItemStatusError
                    }`}
                  >
                    {record.status === "success"
                      ? t("cronJobs.historyStatusSuccess")
                      : record.status === "running"
                      ? t("cronJobs.historyStatusRunning")
                      : record.status === "cancelled"
                      ? t("cronJobs.historyStatusCancelled")
                      : t("cronJobs.historyStatusFailed")}
                  </span>
                </div>
                <div className={styles.historyItemMeta}>
                  {record.trigger === "manual"
                    ? t("cronJobs.historyTriggerManual")
                    : t("cronJobs.historyTriggerScheduled")}
                </div>
                {record.error &&
                  (() => {
                    const recordKey = `${record.run_at}-${index}`;
                    const expanded = expandedHistoryErrors.has(recordKey);
                    const showToggle = shouldShowErrorToggle(record.error);
                    return (
                      <div>
                        <div
                          className={`${styles.historyItemError} ${
                            !expanded && showToggle
                              ? styles.historyItemErrorCollapsed
                              : ""
                          }`}
                        >
                          {record.error}
                        </div>
                        {showToggle && (
                          <button
                            type="button"
                            className={styles.historyItemErrorToggle}
                            onClick={() => toggleHistoryError(recordKey)}
                          >
                            {expanded
                              ? t("cronJobs.historyCollapse")
                              : t("cronJobs.historyExpand")}
                          </button>
                        )}
                      </div>
                    );
                  })()}
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
};

export default CronJobListContent;
