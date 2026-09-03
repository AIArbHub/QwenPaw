import { useState, useEffect } from "react";
import { getApiUrl, getApiToken } from "../../../../api/config";
import { buildAuthHeaders } from "../../../../api/authHeaders";

/**
 * Per-agent 统计信息（用于 AgentCard 三联格展示）。
 */
export interface AgentStatInfo {
  sessions: number;
  lastActive: string;
}

/**
 * 以指定智能体身份请求会话列表，得到该智能体的会话数与最近活跃时间。
 * 后端通过 `X-Agent-Id` 请求头区分归属，因此这里用 fetch 临时覆盖该头，
 * 而不经过全局 selectedAgent 的 request 封装。
 */
async function fetchAgentChatList(
  agentId: string,
): Promise<Array<{ id: string; updated_at: string | null }>> {
  const url = getApiUrl(
    "/chats?archived=false&include_app_owned=false",
  );
  const headers: Record<string, string> = buildAuthHeaders();
  // 覆盖当前登录态携带的 selectedAgent，按目标智能体计数。
  headers["X-Agent-Id"] = agentId;
  const token = getApiToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (!res.ok) return [];
  const data = (await res.json()) as Array<{
    id: string;
    updated_at: string | null;
  }>;
  return Array.isArray(data) ? data : [];
}

function formatLastActive(ts: string | null | undefined): string {
  if (!ts) return "--";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "--";
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < hour && diff >= 0) return `${Math.max(1, Math.floor(diff / minute))}分钟前`;
  if (diff < day && diff >= 0) return `${Math.floor(diff / hour)}小时前`;
  if (diff >= 0 && diff < 7 * day) return `${Math.floor(diff / day)}天前`;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * useAgentStatsBatch — 批量获取各智能体的会话统计。
 *
 * 后端 `/agent-stats` 仅返回当前智能体（X-Agent-Id）维度的全局聚合，不含
 * 按 agent_id 索引的结构；同时消息数需要逐会话深度查询，代价过高。因此这里
 * 采用「逐智能体拉取会话列表」的方式统计会话数与最近活跃时间，消息数暂不接入
 * （卡片对应格子显示 `--` 占位）。当智能体列表切换时传入新的 agentIds 重新拉取。
 */
export function useAgentStatsBatch(
  agentIds: string[],
): {
  statsMap: Record<string, AgentStatInfo>;
  loading: boolean;
} {
  const [statsMap, setStatsMap] = useState<Record<string, AgentStatInfo>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = [...new Set(agentIds)].filter(Boolean);
    if (ids.length === 0) {
      setStatsMap({});
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const fetchAll = async () => {
      try {
        const entries = await Promise.all(
          ids.map(async (agentId) => {
            const chats = await fetchAgentChatList(agentId);
            let lastTs: string | null = null;
            for (const c of chats) {
              if (c.updated_at && (!lastTs || c.updated_at > lastTs)) {
                lastTs = c.updated_at;
              }
            }
            return [
              agentId,
              { sessions: chats.length, lastActive: formatLastActive(lastTs) },
            ] as const;
          }),
        );
        if (cancelled) return;
        setStatsMap(Object.fromEntries(entries));
      } catch {
        // 静默失败 — 卡片显示 `--` 占位，不阻塞页面
        if (!cancelled) setStatsMap({});
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchAll();

    return () => {
      cancelled = true;
    };
  }, [agentIds]);

  return { statsMap, loading };
}

export default useAgentStatsBatch;