import { useState, useEffect } from "react";
import { agentStatsApi } from "../../../../api/modules/agentStats";

/**
 * Per-agent 统计信息（用于 AgentCard 三联格展示）。
 */
export interface AgentStatInfo {
  sessions: number;
  messages: number;
  lastActive: string;
}

/**
 * useAgentStatsBatch — 批量获取智能体统计信息。
 *
 * 调用一次 `agentStatsApi.getAgentStats()` 获取全局统计摘要。当前 API
 * 返回的是全局聚合数据，不含 per-agent 粒度的 agent_id 字段，因此无法
 * 按 agent_id 索引。此时 statsMap 为空对象，AgentCard 的统计三联格显示
 * `--` 占位。若后端后续扩展为 per-agent 粒度，只需在此补充映射逻辑即可。
 */
export function useAgentStatsBatch(): {
  statsMap: Record<string, AgentStatInfo>;
  loading: boolean;
} {
  const [statsMap, setStatsMap] = useState<Record<string, AgentStatInfo>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      setLoading(true);
      try {
        const today = new Date();
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(today.getDate() - 30);

        await agentStatsApi.getAgentStats({
          start_date: thirtyDaysAgo.toISOString().slice(0, 10),
          end_date: today.toISOString().slice(0, 10),
        });

        if (cancelled) return;

        setStatsMap({});
      } catch {
        if (!cancelled) {
          // 静默失败 — 卡片显示 `--` 占位，不阻塞页面
          setStatsMap({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchStats();

    return () => {
      cancelled = true;
    };
  }, []);

  return { statsMap, loading };
}

export default useAgentStatsBatch;
