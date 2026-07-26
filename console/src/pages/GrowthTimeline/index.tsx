import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Empty,
  Spin,
  Timeline,
  message,
} from "antd";
import {
  ReloadOutlined,
  RocketOutlined,
  TrophyOutlined,
  ExperimentOutlined,
  BulbOutlined,
} from "@ant-design/icons";
import { PageHeader } from "@/components/PageHeader";
import { useAgentStore } from "@/stores/agentStore";
import { agentStatsApi } from "@/api/modules/agentStats";
import feedbackApi from "@/api/modules/feedback";
import styles from "./index.module.less";

// ── 反思记录类型 ────────────────────────────────────────────────────────

interface ReflectionEntry {
  id: string;
  date: string;
  type: "capability" | "improvement" | "milestone";
  title: string;
  content: string;
  capabilities: string[];
}

// ── 模拟反思数据生成器（从统计数据推断） ────────────────────────────────

function generateReflections(
  stats: { total_messages: number; total_tool_calls: number; total_active_sessions: number } | null,
  avgRating: number,
): ReflectionEntry[] {
  const entries: ReflectionEntry[] = [];
  const now = new Date();

  if (stats) {
    if (stats.total_messages > 0) {
      entries.push({
        id: "msg_milestone",
        date: now.toISOString(),
        type: "milestone",
        title: "对话里程碑",
        content: `累计处理 ${stats.total_messages} 条消息，覆盖 ${stats.total_active_sessions} 个活跃会话。`,
        capabilities: ["对话处理", "多会话管理"],
      });
    }
    if (stats.total_tool_calls > 0) {
      entries.push({
        id: "tool_usage",
        date: now.toISOString(),
        type: "capability",
        title: "工具使用能力",
        content: `累计调用工具 ${stats.total_tool_calls} 次，工具使用占比 ${(stats.total_tool_calls / Math.max(stats.total_messages, 1) * 100).toFixed(1)}%。`,
        capabilities: ["工具调用", "自动化执行"],
      });
    }
  }

  if (avgRating > 0) {
    entries.push({
      id: "user_rating",
      date: now.toISOString(),
      type: "improvement",
      title: "用户评分反馈",
      content: `平均评分 ${avgRating.toFixed(1)}/5.0，${avgRating >= 4 ? "用户满意度良好" : avgRating >= 3 ? "有改进空间" : "需要重点关注"}。`,
      capabilities: ["用户满意度", "反馈响应"],
    });
  }

  return entries;
}

// ── 主页面 ──────────────────────────────────────────────────────────────

export default function GrowthTimelinePage() {
  const { selectedAgent, agents } = useAgentStore();
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<{
    total_messages: number;
    total_tool_calls: number;
    total_active_sessions: number;
  } | null>(null);
  const [avgRating, setAvgRating] = useState(0);
  const [reflections, setReflections] = useState<ReflectionEntry[]>([]);

  const agent = agents.find((a) => a.id === selectedAgent);

  const fetchData = useCallback(async () => {
    if (!selectedAgent) return;
    setLoading(true);
    try {
      // 并行获取统计和评分
      const [statsRes, feedbackRes] = await Promise.all([
        agentStatsApi
          .getAgentStats({
            start_date: new Date(Date.now() - 30 * 24 * 3600 * 1000)
              .toISOString()
              .slice(0, 10),
            end_date: new Date().toISOString().slice(0, 10),
          })
          .catch(() => null),
        feedbackApi.getSummary(selectedAgent).catch(() => null),
      ]);

      const statsData = statsRes
        ? {
            total_messages: statsRes.total_messages || 0,
            total_tool_calls: statsRes.total_tool_calls || 0,
            total_active_sessions: statsRes.total_active_sessions || 0,
          }
        : null;
      setStats(statsData);

      const rating = feedbackRes?.avg_rating || 0;
      setAvgRating(rating);

      setReflections(generateReflections(statsData, rating));
    } catch (err) {
      message.error(
        err instanceof Error ? err.message : "加载成长数据失败",
      );
    } finally {
      setLoading(false);
    }
  }, [selectedAgent]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 时间线图标
  const timelineIcon = (type: string) => {
    switch (type) {
      case "milestone":
        return <TrophyOutlined style={{ color: "#ff9138" }} />;
      case "capability":
        return <RocketOutlined style={{ color: "#615ced" }} />;
      case "improvement":
        return <ExperimentOutlined style={{ color: "#13c2c2" }} />;
      default:
        return <BulbOutlined style={{ color: "#8c8c8c" }} />;
    }
  };

  return (
    <div className={styles.growthPage}>
      <PageHeader
        current="成长时间轴"
        subRow={
          <div style={{ color: "var(--sd-muted)", fontSize: 13 }}>
            {agent ? `${agent.name} 的能力成长记录与反思` : "请选择智能体"}
          </div>
        }
      />

      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <Button
          icon={<ReloadOutlined />}
          onClick={fetchData}
          loading={loading}
        >
          刷新
        </Button>
      </div>

      <Spin spinning={loading}>
        {/* 统计概览 */}
        {stats && (
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <div className={styles.statValue}>
                {stats.total_messages}
              </div>
              <div className={styles.statLabel}>消息总数</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statValue}>
                {stats.total_tool_calls}
              </div>
              <div className={styles.statLabel}>工具调用</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statValue}>
                {stats.total_active_sessions}
              </div>
              <div className={styles.statLabel}>活跃会话</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statValue}>
                {avgRating.toFixed(1)}
              </div>
              <div className={styles.statLabel}>平均评分</div>
            </div>
          </div>
        )}

        {/* 成长时间轴 */}
        <div className={styles.timelineSection}>
          <div className={styles.sectionTitle}>
            <BulbOutlined />
            成长记录
          </div>
          {reflections.length === 0 ? (
            <Empty description="暂无成长记录" />
          ) : (
            <Timeline
              items={reflections.map((entry) => ({
                key: entry.id,
                dot: timelineIcon(entry.type),
                children: (
                  <div className={styles.reflectionItem}>
                    <div className={styles.reflectionHeader}>
                      <span className={styles.reflectionTitle}>
                        {entry.title}
                      </span>
                      <span className={styles.reflectionDate}>
                        {new Date(entry.date).toLocaleDateString()}
                      </span>
                    </div>
                    <div className={styles.reflectionContent}>
                      {entry.content}
                    </div>
                    {entry.capabilities.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {entry.capabilities.map((cap) => (
                          <span
                            key={cap}
                            className={styles.capabilityBadge}
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          )}
        </div>
      </Spin>
    </div>
  );
}
