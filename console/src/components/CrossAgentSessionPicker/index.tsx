/**
 * CrossAgentSessionPicker — a dropdown that aggregates chat sessions across
 * all agents (each agent's chats fetched with its own X-Agent-Id header),
 * merged and deduplicated into a single picker.
 *
 * Extracted from the experimental ChatMultiInstance (M-A1-2) so the A1
 * product entry point (`/chat`) can offer the same "open existing session
 * from any agent" capability without depending on the experimental surface.
 *
 * The component is self-contained: it reads the agent list, fetches each
 * agent's chats, deduplicates by chatId, and calls onPick(chatId, agentId)
 * when the user selects a session. The parent is responsible for navigation.
 */
import { useEffect, useMemo, useState } from "react";
import { Dropdown, Spin, Input, Empty } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useAgentStore } from "../../stores/agentStore";
import { chatApi } from "../../api/modules/chat";
import { resolveAgentDisplayName } from "../../utils/hostAgent";
import type { ChatSpec } from "../../api/types";

export interface AggChat {
  chatId: string;
  agentId: string;
  name: string;
}

interface CrossAgentSessionPickerProps {
  onPick: (chatId: string, agentId: string) => void;
  /** Optional trigger element. Defaults to a search-styled button. */
  children?: React.ReactNode;
  /** Optional className for the trigger wrapper. */
  className?: string;
}

export default function CrossAgentSessionPicker({
  onPick,
  children,
  className,
}: CrossAgentSessionPickerProps) {
  const agents = useAgentStore((s) => s.agents);
  const [aggChats, setAggChats] = useState<AggChat[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const load = async () => {
      const out: AggChat[] = [];
      for (const a of agents) {
        try {
          const list = await chatApi.listChats({
            agent_id: a.id,
            archived: false,
            include_app_owned: false,
          });
          for (const c of list ?? []) {
            if (!c.id) continue;
            out.push({
              chatId: c.id,
              agentId: a.id,
              name: c.name?.trim() || c.id,
            });
          }
        } catch {
          // Skip agents that fail (e.g. no access)
        }
      }
      if (!cancelled) {
        setAggChats(out);
        setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [agents, open]);

  // Dedupe by chatId (keep the first, preferring a non-id name).
  const chatMap = useMemo(() => {
    const byId = new Map<string, AggChat>();
    for (const c of aggChats) {
      const prev = byId.get(c.chatId);
      if (!prev || (prev.name === c.chatId && c.name !== c.chatId)) {
        byId.set(c.chatId, c);
      }
    }
    return byId;
  }, [aggChats]);

  // Group by agentId for display
  const groupedByAgent = useMemo(() => {
    const map = new Map<string, AggChat[]>();
    const searchLower = search.trim().toLowerCase();
    for (const c of chatMap.values()) {
      if (
        searchLower &&
        !c.name.toLowerCase().includes(searchLower) &&
        !c.chatId.toLowerCase().includes(searchLower)
      ) {
        continue;
      }
      const arr = map.get(c.agentId) ?? [];
      arr.push(c);
      map.set(c.agentId, arr);
    }
    return map;
  }, [chatMap, search]);

  const menuContent = (
    <div
      style={{
        minWidth: 320,
        maxHeight: 400,
        overflowY: "auto",
        padding: "4px 0",
      }}
    >
      <div style={{ padding: "0 8px 8px" }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索会话…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          size="small"
        />
      </div>
      {loading ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin size="small" />
        </div>
      ) : groupedByAgent.size === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="无会话"
          styles={{ root: { padding: 16 } }}
        />
      ) : (
        Array.from(groupedByAgent.entries()).map(([agentId, chats]) => {
          const agentName =
            agentId === "default"
              ? "默认"
              : resolveAgentDisplayName(agentId, agents) ?? agentId;
          return (
            <div key={agentId}>
              <div
                style={{
                  padding: "4px 12px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--ant-color-text-tertiary, #999)",
                  textTransform: "uppercase",
                }}
              >
                {agentName}
              </div>
              {chats.map((c) => (
                <div
                  key={`${agentId}-${c.chatId}`}
                  style={{
                    padding: "6px 12px",
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                  onClick={() => {
                    onPick(c.chatId, c.agentId);
                    setOpen(false);
                    setSearch("");
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background =
                      "var(--ant-color-fill-tertiary, rgba(0,0,0,0.04))";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {c.name || c.chatId}
                </div>
              ))}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <Dropdown
      trigger={["click"]}
      open={open}
      onOpenChange={setOpen}
      dropdownRender={() => menuContent}
    >
      <span className={className} style={{ cursor: "pointer" }}>
        {children}
      </span>
    </Dropdown>
  );
}
