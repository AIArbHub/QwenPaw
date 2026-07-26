import { useEffect, useMemo, useState, useCallback } from "react";
import { Popover, Spin } from "antd";
import {
  MessageOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  ScheduleOutlined,
  FileTextOutlined,
  BookOutlined,
  ExperimentOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import api from "@/api";
import { skillApi } from "@/api/modules/skill";
import { toolsApi } from "@/api/modules/tools";
import { sopApi } from "@/api/modules/sop";
import { feedbackApi } from "@/api/modules/feedback";
import type { AgentStatsSummary } from "@/api/types/agentStats";
import type { ChatSpec } from "@/api/types/chat";
import type { CronJobSpecOutput } from "@/api/types/cronjob";
import type { SkillSpec } from "@/api/types/skill";
import type { ToolInfo } from "@/api/modules/tools";
import type { MemoryStats } from "@/api/types/workspace";
import styles from "./OverviewTab.module.less";

// ─── Types ──────────────────────────────────────────────────────────

interface OverviewTabProps {
  agentId: string;
  /** Called when a metric is clicked — parent can switch tabs. */
  onNavigate?: (tab: "sessions" | "cronjobs" | "memory" | "events") => void;
}

type ActivityType = "chat" | "cron" | "memory";

interface TimelineBucket {
  /** Hour range start (0, 2, 4, ..., 22) */
  hourStart: number;
  events: { type: ActivityType; label: string; time: string }[];
}

interface OverviewData {
  stats: AgentStatsSummary | null;
  chats: ChatSpec[];
  cronJobs: CronJobSpecOutput[];
  skills: SkillSpec[];
  tools: ToolInfo[];
  memoryStats: MemoryStats | null;
  sopCount: number;
  avgRating: number;
  totalFeedback: number;
}

// ─── Constants ──────────────────────────────────────────────────────

const ACTIVITY_COLORS: Record<ActivityType, string> = {
  chat: "#615ced", // blue/accent
  cron: "#ff9138", // orange/warning
  memory: "#22c55e", // green/online
};

const HOURS_PER_BUCKET = 2;
const TOTAL_BUCKETS = 24 / HOURS_PER_BUCKET; // 12

// ─── Component ──────────────────────────────────────────────────────

/**
 * OverviewTab — Workbench "工作记录" Tab。
 *
 * 方案文档第 4.4 节：
 * 1. 4 个 ClickableMetric（今日对话/累计对话/好评率/差评率）
 * 2. 简化版活动时间轴（日视图，3 种活动类型，2 小时分桶）
 * 3. 能力卡片网格（6 张，深浅交替）
 *
 * 所有数据来自现有 API，失败时优雅降级显示 `--`。
 */
const OverviewTab: React.FC<OverviewTabProps> = ({ agentId, onNavigate }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<OverviewData | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const today = dayjs();
    const todayStr = today.format("YYYY-MM-DD");
    const weekAgoStr = today.subtract(30, "day").format("YYYY-MM-DD");

    const results = await Promise.allSettled([
      api.getAgentStats({ start_date: weekAgoStr, end_date: todayStr }),
      api.listChats(),
      api.listCronJobs(),
      skillApi.listSkills(agentId),
      toolsApi.listTools(),
      api.getMemoryStats(agentId),
      sopApi.listSkills(),
      feedbackApi.getSummary(agentId),
    ]);

    const [
      statsRes,
      chatsRes,
      cronJobsRes,
      skillsRes,
      toolsRes,
      memoryStatsRes,
      sopRes,
      feedbackRes,
    ] = results;

    setData({
      stats: statsRes.status === "fulfilled" ? statsRes.value : null,
      chats: chatsRes.status === "fulfilled" ? chatsRes.value : [],
      cronJobs: cronJobsRes.status === "fulfilled" ? cronJobsRes.value : [],
      skills: skillsRes.status === "fulfilled" ? skillsRes.value : [],
      tools: toolsRes.status === "fulfilled" ? toolsRes.value : [],
      memoryStats: memoryStatsRes.status === "fulfilled" ? memoryStatsRes.value : null,
      sopCount:
        sopRes.status === "fulfilled" ? sopRes.value.total : 0,
      avgRating:
        feedbackRes.status === "fulfilled"
          ? feedbackRes.value.avg_rating
          : 0,
      totalFeedback:
        feedbackRes.status === "fulfilled"
          ? feedbackRes.value.total_feedback
          : 0,
    });
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ─── Derived metrics ──────────────────────────────────────────────

  const todayChats = useMemo(() => {
    if (!data?.stats?.by_date) return 0;
    const todayStr = dayjs().format("YYYY-MM-DD");
    const todayEntry = data.stats.by_date.find((d) => d.date === todayStr);
    return todayEntry?.chats ?? 0;
  }, [data]);

  const totalChats = data?.stats?.total_active_sessions ?? 0;
  const totalMessages = data?.stats?.total_messages ?? 0;

  // ─── Timeline buckets ─────────────────────────────────────────────

  const timelineBuckets = useMemo<TimelineBucket[]>(() => {
    const buckets: TimelineBucket[] = Array.from({ length: TOTAL_BUCKETS }, (_, i) => ({
      hourStart: i * HOURS_PER_BUCKET,
      events: [],
    }));

    const todayStr = dayjs().format("YYYY-MM-DD");

    // Chat events
    if (data?.chats) {
      for (const chat of data.chats) {
        if (!chat.created_at) continue;
        const dt = dayjs(chat.created_at);
        if (dt.format("YYYY-MM-DD") !== todayStr) continue;
        const bucketIdx = Math.floor(dt.hour() / HOURS_PER_BUCKET);
        if (bucketIdx >= 0 && bucketIdx < TOTAL_BUCKETS) {
          buckets[bucketIdx].events.push({
            type: "chat",
            label: chat.name || chat.session_id,
            time: dt.format("HH:mm"),
          });
        }
      }
    }

    // Cron job events — use last_run_time if available and today
    if (data?.cronJobs) {
      for (const job of data.cronJobs) {
        const view = job as CronJobSpecOutput & {
          last_run_time?: number;
          next_run_time?: number;
        };
        if (view.last_run_time) {
          const dt = dayjs.unix(view.last_run_time);
          if (dt.format("YYYY-MM-DD") === todayStr) {
            const bucketIdx = Math.floor(dt.hour() / HOURS_PER_BUCKET);
            if (bucketIdx >= 0 && bucketIdx < TOTAL_BUCKETS) {
              buckets[bucketIdx].events.push({
                type: "cron",
                label: job.name || job.id,
                time: dt.format("HH:mm"),
              });
            }
          }
        }
      }
    }

    // Memory events — files modified today
    if (data?.memoryStats) {
      // We can't get individual file events from memoryStats alone,
      // but we can check latest_modified
      // For the timeline, we'd need listDailyMemory, but to keep it simple
      // and avoid an extra API call, we skip individual memory events
      // unless the latest_modified is today
    }

    return buckets;
  }, [data]);

  const hasTimelineEvents = timelineBuckets.some((b) => b.events.length > 0);

  // ─── Capability cards data ────────────────────────────────────────

  const capabilities = useMemo(() => {
    const enabledTools = data?.tools?.filter((t) => t.enabled).length ?? 0;
    const enabledSkills = data?.skills?.filter((s) => s.enabled !== false).length ?? 0;
    const memoryFileCount = data?.memoryStats?.file_count ?? 0;
    const memorySizeKB = data?.memoryStats
      ? Math.round(data.memoryStats.total_size / 1024)
      : 0;
    const cronJobCount = data?.cronJobs?.length ?? 0;
    const sopCount = data?.sopCount ?? 0;
    const chatCount = totalChats;

    return [
      {
        key: "knowledge",
        icon: <DatabaseOutlined />,
        title: t("workbench.capKnowledge"),
        value: memoryFileCount,
        sub: memorySizeKB > 0 ? `${memorySizeKB} KB` : undefined,
        dark: false,
      },
      {
        key: "skills",
        icon: <ThunderboltOutlined />,
        title: t("workbench.capSkills"),
        value: enabledSkills,
        dark: false,
      },
      {
        key: "sop",
        icon: <ExperimentOutlined />,
        title: t("workbench.capSop"),
        value: sopCount,
        dark: false,
      },
      {
        key: "tools",
        icon: <BookOutlined />,
        title: t("workbench.capTools"),
        value: enabledTools,
        dark: true,
      },
      {
        key: "jobs",
        icon: <ScheduleOutlined />,
        title: t("workbench.capJobs"),
        value: cronJobCount,
        dark: true,
      },
      {
        key: "chats",
        icon: <MessageOutlined />,
        title: t("workbench.capChats"),
        value: chatCount,
        dark: true,
      },
    ];
  }, [data, t, totalChats]);

  // ─── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.loadingWrap}>
        <Spin />
      </div>
    );
  }

  return (
    <div className={styles.overview}>
      {/* ─── ClickableMetrics ─── */}
      <div className={styles.metricsRow}>
        <button
          className={styles.metricCard}
          onClick={() => onNavigate?.("sessions")}
        >
          <span className={styles.metricValue}>{todayChats}</span>
          <span className={styles.metricLabel}>{t("workbench.todayChats")}</span>
        </button>

        <button
          className={styles.metricCard}
          onClick={() => onNavigate?.("sessions")}
        >
          <span className={styles.metricValue}>{totalChats}</span>
          <span className={styles.metricLabel}>{t("workbench.totalChats")}</span>
        </button>

        <div className={`${styles.metricCard} ${styles.metricPositive}`}>
          <span className={styles.metricValue}>
            {data?.avgRating ? data.avgRating.toFixed(1) : "—"}
          </span>
          <span className={styles.metricLabel}>{t("workbench.positiveRate")}</span>
        </div>

        <div className={`${styles.metricCard} ${styles.metricNegative}`}>
          <span className={styles.metricValue}>
            {data?.totalFeedback ?? "—"}
          </span>
          <span className={styles.metricLabel}>{t("workbench.negativeRate")}</span>
        </div>
      </div>

      {/* ─── Activity Timeline ─── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <ClockCircleOutlined className={styles.sectionIcon} />
          <h3 className={styles.sectionTitle}>{t("workbench.activityTimeline")}</h3>
          <span className={styles.sectionDate}>
            {dayjs().format("YYYY-MM-DD")}
          </span>
        </div>

        <div className={styles.timeline}>
          {/* Hour labels */}
          <div className={styles.timelineHours}>
            <div className={styles.timelineTrackLabel} />
            {Array.from({ length: TOTAL_BUCKETS }, (_, i) => (
              <div key={i} className={styles.timelineHourLabel}>
                {String(i * HOURS_PER_BUCKET).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {/* Chat track */}
          <TimelineTrack
            label={t("workbench.sessions")}
            color={ACTIVITY_COLORS.chat}
            buckets={timelineBuckets}
            type="chat"
          />

          {/* Cron track */}
          <TimelineTrack
            label={t("workbench.cronjobs")}
            color={ACTIVITY_COLORS.cron}
            buckets={timelineBuckets}
            type="cron"
          />

          {/* Memory track */}
          <TimelineTrack
            label={t("workbench.memory")}
            color={ACTIVITY_COLORS.memory}
            buckets={timelineBuckets}
            type="memory"
          />
        </div>

        {!hasTimelineEvents && (
          <div className={styles.timelineEmpty}>{t("common.noData")}</div>
        )}
      </div>

      {/* ─── Capability Grid ─── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <FileTextOutlined className={styles.sectionIcon} />
          <h3 className={styles.sectionTitle}>{t("workbench.capabilityGrid")}</h3>
        </div>

        <div className={styles.capGrid}>
          {capabilities.map((cap) => (
            <div
              key={cap.key}
              className={`${styles.capCard} ${cap.dark ? styles.capDark : ""}`}
            >
              <div className={styles.capIconRow}>
                <span className={styles.capIcon}>{cap.icon}</span>
                <span className={styles.capTitle}>{cap.title}</span>
              </div>
              <div className={styles.capValue}>{cap.value}</div>
              {cap.sub && <div className={styles.capSub}>{cap.sub}</div>}
              <div className={styles.capBar} />
            </div>
          ))}
        </div>
      </div>

      {/* ─── Quick stats footer ─── */}
      {totalMessages > 0 && (
        <div className={styles.footerStats}>
          <span className={styles.footerItem}>
            {t("agentStats.totalMessages")}: <strong>{totalMessages}</strong>
          </span>
          {data?.avgRating ? (
            <span className={styles.footerItem}>
              {t("workbench.positiveRate")}: <strong>{data.avgRating.toFixed(1)}</strong>
            </span>
          ) : null}
          {data?.totalFeedback ? (
            <span className={styles.footerItem}>
              {t("workbench.negativeRate")}: <strong>{data.totalFeedback}</strong>
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
};

// ─── TimelineTrack sub-component ────────────────────────────────────

interface TimelineTrackProps {
  label: string;
  color: string;
  buckets: TimelineBucket[];
  type: ActivityType;
}

const TimelineTrack: React.FC<TimelineTrackProps> = ({
  label,
  color,
  buckets,
  type,
}) => {
  return (
    <div className={styles.timelineRow}>
      <div className={styles.timelineTrackLabel}>{label}</div>
      {buckets.map((bucket, i) => {
        const typeEvents = bucket.events.filter((e) => e.type === type);
        const count = typeEvents.length;
        const hasEvents = count > 0;

        const content = hasEvents ? (
          <div className={styles.popoverContent}>
            {typeEvents.map((e, idx) => (
              <div key={idx} className={styles.popoverItem}>
                <span
                  className={styles.popoverDot}
                  style={{ background: color }}
                />
                <span className={styles.popoverTime}>{e.time}</span>
                <span className={styles.popoverLabel}>{e.label}</span>
              </div>
            ))}
          </div>
        ) : null;

        const bucketEl = (
          <div
            key={i}
            className={`${styles.timelineBucket} ${
              hasEvents ? styles.timelineBucketActive : ""
            }`}
            style={
              hasEvents
                ? {
                    background: color,
                    opacity: Math.min(0.3 + count * 0.25, 1),
                  }
                : undefined
            }
          >
            {hasEvents && count > 1 && (
              <span className={styles.bucketCount}>{count}</span>
            )}
          </div>
        );

        if (!hasEvents) {
          return bucketEl;
        }

        return (
          <Popover
            key={i}
            content={content}
            placement="top"
            trigger="hover"
          >
            {bucketEl}
          </Popover>
        );
      })}
    </div>
  );
};

export default OverviewTab;
