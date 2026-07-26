import { useState, useEffect } from "react";
import api from "../../../../api";
import type { AgentStatsSummary } from "../../../../api/types/agentStats";

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
 * 策略（见方案文档第 2.2 节 / 风险与对策）：
 * 调用一次 `api.getAgentStats()` 获取全局统计摘要。当前 API 返回的
 * `AgentStatsSummary` 是全局聚合数据，不含 per-agent 粒度的 agent_id
 * 字段，因此无法按 agent_id 索引。此时 statsMap 为空对象，AgentCard
 * 的统计三联格显示 `--` 占位。
 *
 * 若后端后续扩展为返回 per-agent 粒度数据，只需在 indexByAgent 中补充
 * 映射逻辑即可自动生效。
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

        const summary: AgentStatsSummary = await api.getAgentStats({
          start_date: thirtyDaysAgo.toISOString().slice(0, 10),
          end_date: today.toISOString().slice(0, 10),
        });

        if (cancelled) return;

        // 当前 API 返回全局聚合统计，无 agent_id 字段，无法按 agent 索引。
        // 保留映射逻辑框架，待后端支持 per-agent 后自动生效。
        const indexed = indexByAgent(summary);
        setStatsMap(indexed);
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

/**
 * 将全局统计摘要按 agent_id 索引。
 * 当前 AgentStatsSummary 不含 per-agent 数据，返回空对象。
 */
function indexByAgent(_summary: AgentStatsSummary): Record<
  string,
  AgentStatInfo
> {
  // TODO: 后端支持 per-agent 粒度后，在此映射 summary → Record<agentId, AgentStatInfo>
  return {};
}

export default useAgentStatsBatch;
