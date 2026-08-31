import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode } from "react";
import { Layout, Tooltip, Badge, Avatar, Spin, Divider, Popover, Input } from "antd";
import {
  Routes,
  Route,
  useLocation,
  useNavigate,
  matchPath,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  MessageSquareText,
  MessageSquarePlus,
  History,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Search,
  Users2,
  Plus,
  Info,
  Sparkles,
  Zap,
  Brain,
  Tag,
  ChevronDown,
} from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useRoutes, useMenuItems } from "../../plugins/registry/hooks";
import {
  routeIdToPath,
  flattenMenu,
  renderIcon,
  resolveLabel,
  findMenuItem,
} from "../registry/adapter";
import { filterMenuForAgentCapabilities } from "../registry/capabilities";
import type { MenuItem } from "../../plugins/registry/types";
import type { AgentSummary } from "../../api/types/agents";
import { buildChatPath } from "../../utils/sessionRoute";
import ConsolePollService from "../../components/ConsolePollService";
import { AgentStatusPollingController } from "../../components/AgentStatusPollingController";
import { ChunkErrorBoundary } from "../../components/ChunkErrorBoundary";
import { Slot } from "../../plugins/registry/Slot";
import { useTheme } from "../../contexts/ThemeContext";
import SidebarSettingsPanel from "../SidebarSettingsPanel";
import CreateGroupChatModal from "../../components/CreateGroupChatModal";
import EditGroupChatModal from "../../components/EditGroupChatModal";
import CreateAgentModal from "../../components/CreateAgentModal";
import { agentsApi } from "../../api/modules/agents";
import { useAppMessage } from "../../hooks/useAppMessage";
import {
  HOST_MODE_LABEL,
  isHostAgent,
  parseHostMeta,
  stripHostMeta,
} from "../../utils/hostAgent";
import styles from "./designLayout.module.less";
import { AgentDetailDrawer } from "../../pages/Settings/Agents/components";

// ── Types ───────────────────────────────────────────────────────────────────

/** MenuItem with the dynamically-attached __children field from sortAndTree. */
type TreeMenuItem = MenuItem & { __children?: MenuItem[] };

interface RailItem {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  path?: string;
  href?: string;
  isGroupHeader?: boolean;
  showBadge?: boolean;
}

interface FeatureCardData {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  path?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const RAIL_ICON_SIZE = 20;
const FEATURE_ICON_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
  running: "#34c759",
  starting: "#0065fd",
  failed: "#ff3b30",
  disabled: "#999999",
  pending: "#999999",
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

/**
 * 分组标签：展示当前分组，点击后内联编辑并保存。
 * 通过 onSave 回调把新值持久化到后端。
 */
function GroupTag({
  group,
  onSave,
}: {
  group?: string;
  onSave: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(group || "");

  useEffect(() => {
    setDraft(group || "");
  }, [group]);

  const handleConfirm = () => {
    setOpen(false);
    onSave(draft);
  };

  const label = (group || "").trim();

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setDraft(group || "");
      }}
      trigger="click"
      placement="bottomLeft"
      content={
        <div className={styles.groupEditPopover}>
          <Input
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPressEnter={handleConfirm}
            placeholder="分组名称"
            maxLength={20}
          />
          <button
            type="button"
            className={styles.groupEditSave}
            onClick={handleConfirm}
          >
            保存
          </button>
        </div>
      }
    >
      <span
        className={`${styles.groupTag}${label ? "" : ` ${styles.groupTagEmpty}`}`}
        onClick={(e) => e.stopPropagation()}
        title={label ? `${label}（点击修改分组）` : "设置分组"}
      >
        <Tag size={10} />
        {label || "分组"}
      </span>
    </Popover>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

/**
 * DesignLayout — a three-column layout that replaces the standard
 * Header + Sidebar + Content arrangement when sidebarMode === "design".
 *
 * Column 1 (left rail, 72px collapsed / 240px expanded): global navigation.
 * Column 2 (middle panel, 320px): agent list ↔ agent detail.
 * Column 3 (content, flexible): route rendering (same as MainLayout).
 *
 * The left rail uses custom `.railMenuItem` elements (not antd Menu) to achieve
 * the precise collapsed/expanded styling (44×44 icon buttons, blue left-bar
 * indicator, tooltips on hover, etc.) described in the design spec.
 */
export default function DesignLayout({
  hubMode = false,
}: {
  hubMode?: boolean;
}) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [railCollapsed, setRailCollapsed] = useState(true);
  const [panelAgentId, setPanelAgentId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [middleCollapsed, setMiddleCollapsed] = useState(false);
  const [middleUserToggled, setMiddleUserToggled] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [editGroupAgent, setEditGroupAgent] = useState<AgentSummary | null>(
    null,
  );
  const [createAgentOpen, setCreateAgentOpen] = useState(false);
  const [listTab, setListTab] = useState<"agents" | "groups">("agents");
  const [drawerAgent, setDrawerAgent] = useState<AgentSummary | null>(null);
  const [drawerTab, setDrawerTab] = useState("basic");
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  // ── Hooks ──────────────────────────────────────────────────────────────────
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { message } = useAppMessage();
  const {
    agents,
    selectedAgent,
    setSelectedAgent,
    refreshAgents,
    updateAgent,
  } = useAgentStore();
  const routes = useRoutes();
  const rawAgentMenu = useMenuItems("primary.agentScoped");
  const rawSettingsMenu = useMenuItems("primary.settings");

  const currentPath = location.pathname;
  const isChatActive =
    currentPath.startsWith("/chat") ||
    currentPath.startsWith("/groups/");

  // ── Auto-collapse middle panel when content is unrelated to agents ────────
  // If the user hasn't manually toggled, auto-collapse when navigating away
  // from chat pages, and auto-expand when entering chat.
  useEffect(() => {
    if (middleUserToggled) return;
    setMiddleCollapsed(!isChatActive);
  }, [isChatActive, middleUserToggled]);

  // ── Derived: selected key for menu highlighting ─────────────────────────────
  const selectedKey = useMemo(() => {
    for (const r of routes) {
      if (matchPath({ path: r.path, end: r.path === "/" }, currentPath)) {
        return r.id;
      }
    }
    return "core.chat";
  }, [currentPath, routes]);

  // ── Derived: renderable routes (filter out /apps/:appId inline routes) ─────
  const renderableRoutes = useMemo(
    () => routes.filter((r) => !/^\/apps\/(?!:)/.test(r.path)),
    [routes],
  );

  // ── Derived: current agent capabilities (same pattern as Sidebar) ──────────
  const currentAgent = agents.find((a) => a.id === selectedAgent);
  const backendCapabilities = useMemo(() => {
    if (!currentAgent) return undefined;
    return {
      ...currentAgent.backend_capabilities,
      workspace_ui:
        currentAgent.backend === "aiarb"
          ? currentAgent.backend_capabilities?.workspace_ui ?? true
          : false,
    };
  }, [currentAgent]);

  // ── Derived: agent menu filtered by capabilities ───────────────────────────
  const agentMenu = useMemo(
    () => filterMenuForAgentCapabilities(rawAgentMenu, backendCapabilities),
    [rawAgentMenu, backendCapabilities],
  );

  // ── Derived: left rail items ────────────────────────────────────────────────
  const railItems = useMemo<RailItem[]>(() => {
    const items: RailItem[] = [];

    // 1. Chat (sticky, always visible)
    items.push({
      key: "core.chat",
      icon: <MessageSquareText size={RAIL_ICON_SIZE} />,
      label: t("nav.chat"),
      path: buildChatPath(),
    });

    // 2. Inbox (extract from agent menu — global in design mode)
    const inboxItem = findMenuItem(rawAgentMenu, "core.inbox");
    if (inboxItem) {
      items.push({
        key: "core.inbox",
        icon: renderIcon(inboxItem.icon, RAIL_ICON_SIZE),
        label: resolveLabel(inboxItem.label),
        path: routeIdToPath(inboxItem.route, routes),
        href: inboxItem.href,
        showBadge: false, // Wire to inbox unread state when available
      });
    }

    // 3. Market (extract from agent menu — global in design mode)
    const marketItem = findMenuItem(rawAgentMenu, "core.marketplace");
    if (marketItem) {
      items.push({
        key: "core.marketplace",
        icon: renderIcon(marketItem.icon, RAIL_ICON_SIZE),
        label: resolveLabel(marketItem.label),
        path: routeIdToPath(marketItem.route, routes),
        href: marketItem.href,
      });
    }

    // 3b. Memory center (global entry in design mode)
    const memoryItem = findMenuItem(rawAgentMenu, "core.memory");
    if (memoryItem) {
      items.push({
        key: "core.memory",
        icon: renderIcon(memoryItem.icon, RAIL_ICON_SIZE),
        label: resolveLabel(memoryItem.label),
        path: routeIdToPath(memoryItem.route, routes),
        href: memoryItem.href,
      });
    }

    // 3c. Shared knowledge base (global entry in design mode)
    const kbItem = findMenuItem(rawAgentMenu, "core.knowledge-base");
    if (kbItem) {
      items.push({
        key: "core.knowledge-base",
        icon: renderIcon(kbItem.icon, RAIL_ICON_SIZE),
        label: resolveLabel(kbItem.label),
        path: routeIdToPath(kbItem.route, routes),
        href: kbItem.href,
      });
    }

    // 4. Settings group header (hidden when collapsed)
    items.push({
      key: "settings-group-header",
      icon: null,
      label: t("nav.settings"),
      isGroupHeader: true,
    });

    // 5. All settings items (flattened)
    const settingsFlat = flattenMenu(rawSettingsMenu, routes, RAIL_ICON_SIZE);
    for (const entry of settingsFlat) {
      items.push({
        key: entry.key,
        icon: entry.icon,
        label: entry.label,
        path: entry.path,
        href: entry.href,
      });
    }

    return items;
  }, [rawAgentMenu, rawSettingsMenu, routes, t]);

  // ── Derived: feature groups for the "功能" tab ─────────────────────────────
  const featureGroups = useMemo(() => {
    const control: FeatureCardData[] = [];
    const workspace: FeatureCardData[] = [];

    // Items under core.control-group → "控制"
    const controlGroup = agentMenu.find(
      (i) => i.id === "core.control-group",
    ) as TreeMenuItem | undefined;
    for (const child of controlGroup?.__children ?? []) {
      if (child.id === "core.inbox" || child.id === "core.marketplace") continue;
      if (child.visible?.() === false) continue;
      control.push({
        key: child.id,
        icon: renderIcon(child.icon, FEATURE_ICON_SIZE),
        label: resolveLabel(child.label),
        path: routeIdToPath(child.route, routes),
      });
    }

    // Items under core.workspace-group → "工作区"
    // (skills is promoted to the "基本信息" group below)
    const workspaceGroup = agentMenu.find(
      (i) => i.id === "core.workspace-group",
    ) as TreeMenuItem | undefined;
    for (const child of workspaceGroup?.__children ?? []) {
      if (child.id === "core.inbox" || child.id === "core.marketplace") continue;
      if (child.id === "core.skills") continue;
      if (child.visible?.() === false) continue;
      workspace.push({
        key: child.id,
        icon: renderIcon(child.icon, FEATURE_ICON_SIZE),
        label: resolveLabel(child.label),
        path: routeIdToPath(child.route, routes),
      });
    }

    // Orphan top-level items (e.g. checkpoints whose parentId "core.agent-group"
    // doesn't exist as a registered group) → also under "工作区"
    for (const item of agentMenu) {
      if (item.isGroup) continue;
      if (item.id === "core.inbox" || item.id === "core.marketplace") continue;
      const treeItem = item as TreeMenuItem;
      if (treeItem.__children && treeItem.__children.length > 0) continue;
      if (item.visible?.() === false) continue;
      workspace.push({
        key: item.id,
        icon: renderIcon(item.icon, FEATURE_ICON_SIZE),
        label: resolveLabel(item.label),
        path: routeIdToPath(item.route, routes),
      });
    }

    // 基本信息 group — static entries (basic/persona open the edit drawer,
    // skills/memory route into the right content panel).
    const profile: FeatureCardData[] = [
      { key: "basic", icon: <Info size={FEATURE_ICON_SIZE} />, label: t("agent.basicInfo", "基本信息") },
      { key: "persona", icon: <Sparkles size={FEATURE_ICON_SIZE} />, label: t("agent.persona", "人设") },
      {
        key: "skills",
        icon: <Zap size={FEATURE_ICON_SIZE} />,
        label: t("nav.skills", "技能"),
        path: routeIdToPath("core.skills", routes),
      },
      {
        key: "memory",
        icon: <Brain size={FEATURE_ICON_SIZE} />,
        label: t("agent.memory", "记忆"),
      },
    ];

    return { profile, control, workspace };
  }, [agentMenu, routes, t]);

  // ── Derived: panel agent object ────────────────────────────────────────────
  const panelAgent = agents.find((a) => a.id === panelAgentId) ?? null;

  // 面板智能体是否为群聊（主持人）智能体，以及其元信息（成员/模式）。
  const panelIsHost = panelAgent ? isHostAgent(panelAgent) : false;
  const panelHostMeta = panelIsHost ? parseHostMeta(panelAgent!) : null;
  const panelHostMemberNames = panelHostMeta
    ? panelHostMeta.members.map((m) => m.name)
    : [];
  const panelHostModeLabel = panelHostMeta
    ? HOST_MODE_LABEL[panelHostMeta.mode]
    : "";
  const panelHostCleanDesc = panelIsHost
    ? stripHostMeta(panelAgent!.description)
    : "";

  // 主持人智能体（群聊）与普通智能体分开展示，避免混在一起。
  const { regularAgents, hostAgents } = useMemo(() => {
    const regular: AgentSummary[] = [];
    const hosts: AgentSummary[] = [];
    for (const agent of agents) {
      if (isHostAgent(agent)) hosts.push(agent);
      else regular.push(agent);
    }
    return { regularAgents: regular, hostAgents: hosts };
  }, [agents]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Load agents on mount
  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleRailItemClick = (item: RailItem) => {
    if (item.isGroupHeader) return;
    if (item.href) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.path) {
      navigate(item.path);
    }
  };

  const handleAgentClick = (agent: AgentSummary) => {
    setPanelAgentId(agent.id);
    // Also update the store's selectedAgent so sessionApi switches owner
    // and the conversation list loads for the correct agent.
    setSelectedAgent(agent.id);
  };

  const handleGroupClick = (agent: AgentSummary) => {
    // 与单个智能体一致：中栏展示详情（新增聊天/基本信息/控制/工作区 + 群聊管理），
    // 同时右栏跳转到该群聊的聊天页。
    setPanelAgentId(agent.id);
    setSelectedAgent(agent.id);
    navigate(buildChatPath());
  };

  const handleOpenDrawer = (agent: AgentSummary, tab: string) => {
    setDrawerAgent(agent);
    setDrawerTab(tab);
  };

  // 新增聊天：若已在聊天页则派发事件创建新会话，否则跳转 /chat。
  const handleNewChat = () => {
    const onChatPage = currentPath.startsWith("/chat");
    if (onChatPage) {
      window.dispatchEvent(new CustomEvent("aiarb:sidebar-new-chat"));
    } else {
      sessionStorage.setItem("aiarb_pending_new_chat", "1");
      navigate(buildChatPath());
    }
  };

  // 历史会话：跳转到会话历史页（右栏区域）。若处于某个智能体详情，则进入其专属历史页。
  const handleHistorySessions = () => {
    if (panelAgent) {
      navigate(`/agents/${encodeURIComponent(panelAgent.id)}/sessions`);
    } else {
      navigate("/sessions");
    }
  };

  const handleProfileCardClick = (card: FeatureCardData) => {
    if (!panelAgent) return;
    if (card.key === "basic") {
      handleOpenDrawer(panelAgent, "basic");
      return;
    }
    if (card.key === "persona") {
      handleOpenDrawer(panelAgent, "persona");
      return;
    }
    if (card.key === "memory") {
      handleOpenDrawer(panelAgent, "memory");
      return;
    }
    if (card.path) {
      navigate(card.path);
    }
  };

  // 列表中直接修改分组：持久化到后端并同步到本地 store。
  const handleGroupChange = async (agentId: string, group: string) => {
    const next = (group || "").trim();
    try {
      await agentsApi.setAgentGroup(agentId, next);
      updateAgent(agentId, { group: next });
      message.success(t("agent.groupUpdated", "分组已更新"));
    } catch (err: unknown) {
      message.error(
        err instanceof Error ? err.message : t("agent.groupUpdateFailed", "分组更新失败"),
      );
    }
  };

  const handleBackClick = () => {
    setPanelAgentId(null);
  };

  const handleFeatureClick = (card: FeatureCardData) => {
    if (card.path) {
      navigate(card.path);
    }
  };

  // 针对某个具体智能体/群聊发起新对话：先切换 selectedAgent（同步生效，
  // 决定 X-Agent-Id 请求头的归属），再走通用新建会话流程。
  const handleAgentNewChat = (agent: AgentSummary) => {
    setSelectedAgent(agent.id);
    handleNewChat();
  };

  // 进入该智能体/群聊的会话历史页。
  const handleAgentHistory = (agent: AgentSummary) => {
    setSelectedAgent(agent.id);
    navigate(`/agents/${encodeURIComponent(agent.id)}/sessions`);
  };

  // 折叠/展开 QQ 好友式分组。
  const toggleGroupCollapse = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── QQ 好友/通讯录式分组 + 搜索 ───────────────────────────────────────────
  const queryNorm = searchQuery.trim().toLowerCase();

  // 按 名称 / id / 基本信息(简介) 检索。
  const filterByQuery = (items: AgentSummary[]): AgentSummary[] => {
    if (!queryNorm) return items;
    return items.filter(
      (a) =>
        (a.name || "").toLowerCase().includes(queryNorm) ||
        (a.id || "").toLowerCase().includes(queryNorm) ||
        (a.description || "").toLowerCase().includes(queryNorm),
    );
  };

  // 将列表按 group 字段折叠成可折叠分组，未分组排最后。
  const groupByGroupName = (
    items: AgentSummary[],
    prefix: string,
  ): Array<{ key: string; label: string; items: AgentSummary[] }> => {
    const src = filterByQuery(items);
    const uncatLabel = t("chat.groups.uncategorized", "未分组");
    const order: string[] = [];
    const map = new Map<string, AgentSummary[]>();
    for (const item of src) {
      const label = (item.group || "").trim() || uncatLabel;
      if (!map.has(label)) {
        map.set(label, []);
        order.push(label);
      }
      map.get(label)!.push(item);
    }
    order.sort((a, b) => {
      if (a === uncatLabel) return 1;
      if (b === uncatLabel) return -1;
      return a.localeCompare(b, "zh-CN");
    });
    return order.map((label) => ({
      key: `${prefix}:${label}`,
      label,
      items: map.get(label)!,
    }));
  };

  const regularGrouped = useMemo(
    () => groupByGroupName(regularAgents, "ag"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regularAgents, searchQuery],
  );
  const hostGrouped = useMemo(
    () => groupByGroupName(hostAgents, "gr"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostAgents, searchQuery],
  );

  // 分组下每个条目的 hover 快捷操作：新增对话 + 对话历史。
  const renderQuickActions = (agent: AgentSummary): ReactNode => (
    <div
      className={styles.hostAgentActions}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip title={t("chat.newChat", "新增对话")}>
        <button
          type="button"
          className={styles.hostAgentActionButton}
          aria-label={t("chat.newChat", "新增对话")}
          onClick={() => handleAgentNewChat(agent)}
        >
          <MessageSquarePlus size={14} />
        </button>
      </Tooltip>
      <Tooltip title={t("sessions.history.shortcut", "对话历史")}>
        <button
          type="button"
          className={styles.hostAgentActionButton}
          aria-label={t("sessions.history.shortcut", "对话历史")}
          onClick={() => handleAgentHistory(agent)}
        >
          <History size={14} />
        </button>
      </Tooltip>
    </div>
  );

  // 单个普通智能体条目。
  const renderAgentItem = (agent: AgentSummary): ReactNode => (
    <div
      key={agent.id}
      className={styles.agentItem}
      role="button"
      tabIndex={0}
      onClick={() => handleAgentClick(agent)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleAgentClick(agent);
        }
      }}
    >
      <div className={styles.agentAvatar}>
        <Avatar
          size={40}
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          {getInitials(agent.name)}
        </Avatar>
        <span
          className={styles.agentStatusDot}
          style={{
            backgroundColor: STATUS_COLORS[agent.startup_status ?? "disabled"],
          }}
        />
      </div>
      <div className={styles.agentInfo}>
        <div className={styles.agentInfoRow}>
          <span className={styles.agentName}>{agent.name}</span>
          {!agent.enabled && (
            <span className={styles.agentTime}>
              {t("agent.disabled", "已禁用")}
            </span>
          )}
        </div>
        <div className={styles.agentDesc}>
          {agent.description || t("agent.noDescription")}
        </div>
        {agent.pinned && (
          <div className={styles.agentMetaRow}>
            <span className={styles.pinnedBadge}>
              {t("agent.pinned", "置顶")}
            </span>
          </div>
        )}
      </div>
      {renderQuickActions(agent)}
    </div>
  );

  // 单个群聊条目。
  const renderHostItem = (agent: AgentSummary): ReactNode => {
    const meta = parseHostMeta(agent);
    const modeLabel = meta ? HOST_MODE_LABEL[meta.mode] : "";
    const memberNames = meta ? meta.members.map((m) => m.name) : [];
    const memberCount = memberNames.length;
    const cleanDesc = stripHostMeta(agent.description);
    return (
      <div
        key={agent.id}
        className={styles.agentItem}
        role="button"
        tabIndex={0}
        onClick={() => handleGroupClick(agent)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleGroupClick(agent);
          }
        }}
      >
        <div className={styles.hostAvatarStack}>
          <Avatar
            size={40}
            className={styles.hostAvatarStackMain}
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <Users2 size={18} />
          </Avatar>
          <span className={styles.hostAvatarStackMini}>{memberCount || "?"}</span>
        </div>
        <div className={styles.agentInfo}>
          <div className={styles.agentInfoRow}>
            <span className={styles.agentName}>{agent.name}</span>
            <span className={styles.agentItemHostBadge}>
              <Users2 size={10} />
              {t("hostModal.badge", "群聊")}
            </span>
          </div>
          {modeLabel && <div className={styles.agentModeTag}>{modeLabel}</div>}
          <div className={styles.agentDesc}>
            {cleanDesc ||
              memberNames.join("、") ||
              t("agent.noDescription")}
          </div>
          {memberCount > 0 && (
            <div className={styles.hostMemberCountPill}>
              {memberNames.slice(0, 3).join("、")}
              {memberCount > 3 ? ` 等 ${memberCount} 人` : `（${memberCount} 人）`}
            </div>
          )}
        </div>
        {renderQuickActions(agent)}
      </div>
    );
  };

  // 折叠分组容器渲染：顶部为分组标题栏，下方为条目。
  const renderGroupedList = (
    groups: Array<{ key: string; label: string; items: AgentSummary[] }>,
    emptyLabel: string,
    isHost: boolean,
  ): ReactNode => {
    if (groups.length === 0) {
      return <div className={styles.emptyState}>{emptyLabel}</div>;
    }
    const searching = !!queryNorm;
    return groups.map((group) => {
      const collapsed = !searching && collapsedGroups.has(group.key);
      return (
        <div key={group.key} className={styles.groupContainer}>
          <div
            className={styles.groupHeader}
            role="button"
            tabIndex={0}
            onClick={() => !searching && toggleGroupCollapse(group.key)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                if (!searching) toggleGroupCollapse(group.key);
              }
            }}
          >
            <ChevronDown
              size={14}
              className={`${styles.groupHeaderChevron}${
                collapsed ? ` ${styles.groupHeaderChevronCollapsed}` : ""
              }`}
            />
            <span className={styles.groupHeaderTitle}>{group.label}</span>
            <span className={styles.groupHeaderCount}>{group.items.length}</span>
          </div>
          {!collapsed &&
            group.items.map((agent) =>
              isHost ? renderHostItem(agent) : renderAgentItem(agent),
            )}
        </div>
      );
    });
  };

  const handleMiddleToggle = () => {
    setMiddleUserToggled(true);
    setMiddleCollapsed((prev) => !prev);
  };

  const handleRailItemClickWithPanel = (item: RailItem) => {
    handleRailItemClick(item);
    // When navigating to chat, auto-expand middle panel
    if (item.path?.startsWith("/chat")) {
      if (!middleUserToggled) {
        setMiddleCollapsed(false);
      }
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className={`${styles.designLayout}${isDark ? ` ${styles.dark}` : ""}${
        !railCollapsed ? ` ${styles.expanded}` : ""
      }${middleCollapsed ? ` ${styles.middleCollapsed}` : ""}`}
    >
      {/* ── Column 1: Left Rail ─────────────────────────────────────────────── */}
      <aside className={styles.leftRail}>
        {/* Logo */}
        <div className={styles.railLogo}>
          <span>A</span>
        </div>

        {/* Scrollable navigation area */}
        <nav className={`${styles.railNavScroll} rail-nav-scroll`}>
          {railItems.map((item) => {
            // Group headers are hidden when collapsed
            if (item.isGroupHeader) {
              if (railCollapsed) return null;
              return (
                <div key={item.key} className={styles.railMenuGroup}>
                  {item.label}
                </div>
              );
            }

            const isActive =
              item.key === "core.chat"
                ? isChatActive
                : selectedKey === item.key;

            const itemContent = (
              <button
                type="button"
                className={`${styles.railMenuItem}${
                  isActive ? ` ${styles.railMenuItemActive}` : ""
                }`}
                onClick={() => handleRailItemClickWithPanel(item)}
              >
                <span className={styles.railMenuItemIcon}>
                  {item.icon}
                  {item.showBadge && (
                    <Badge dot color="#ff3b30" offset={[-2, 2]}>
                      <span />
                    </Badge>
                  )}
                </span>
                <span className={styles.railMenuItemLabel}>{item.label}</span>
              </button>
            );

            if (railCollapsed) {
              return (
                <Tooltip
                  key={item.key}
                  title={item.label}
                  placement="right"
                  styles={{
                    body: {
                      background: "rgba(0,0,0,0.75)",
                      color: "#fff",
                    },
                  }}
                >
                  {itemContent}
                </Tooltip>
              );
            }
            return <div key={item.key}>{itemContent}</div>;
          })}
        </nav>

        {/* Bottom controls (fixed) */}
        <div className={styles.railBottom}>
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement="topRight"
            trigger="click"
            content={
              <SidebarSettingsPanel onClose={() => setSettingsOpen(false)} />
            }
          >
            <button
              ref={settingsButtonRef}
              type="button"
              className={styles.railBottomButton}
            >
              <Settings size={RAIL_ICON_SIZE} />
              {!railCollapsed && <span>{t("nav.settings")}</span>}
            </button>
          </Popover>
          <Tooltip
            title={railCollapsed ? t("common.expand") : t("common.collapse")}
            placement="right"
          >
            <button
              type="button"
              className={styles.railBottomButton}
              onClick={() => setRailCollapsed((prev) => !prev)}
            >
              {railCollapsed ? (
                <PanelLeftOpen size={RAIL_ICON_SIZE} />
              ) : (
                <>
                  <PanelLeftClose size={RAIL_ICON_SIZE} />
                  <span>收起</span>
                </>
              )}
            </button>
          </Tooltip>
        </div>
      </aside>

      {/* ── Column 2: Middle Panel ──────────────────────────────────────────── */}
      <section className={styles.middlePanel}>
        {!middleCollapsed && (
          panelAgentId && panelAgent ? (
          /* ── State B: Agent Detail ── */
          <div className={styles.agentDetail}>
            {/* Back button + agent name */}
            <div className={styles.detailHeader}>
              <button
                type="button"
                className={styles.backButton}
                onClick={handleBackClick}
              >
                <ChevronLeft size={20} />
              </button>
              <span className={styles.detailTitle}>{panelAgent.name}</span>
            </div>

            {/* Agent info — fixed, does not scroll */}
            <div className={styles.detailInfo}>
              {panelIsHost ? (
                <div className={styles.hostAvatarStack}>
                  <Avatar
                    size={40}
                    className={styles.hostAvatarStackMain}
                    style={{ backgroundColor: "var(--color-primary)" }}
                  >
                    <Users2 size={18} />
                  </Avatar>
                  <span className={styles.hostAvatarStackMini}>
                    {panelHostMemberNames.length || "?"}
                  </span>
                </div>
              ) : (
                <Avatar
                  size={40}
                  style={{
                    backgroundColor: "var(--color-primary)",
                    flexShrink: 0,
                  }}
                >
                  {getInitials(panelAgent.name)}
                </Avatar>
              )}
              <div className={styles.detailInfoText}>
                <div className={styles.detailInfoName}>
                  {panelAgent.name}
                  {panelIsHost && (
                    <span className={styles.agentItemHostBadge}>
                      <Users2 size={10} />
                      {t("hostModal.badge", "群聊")}
                    </span>
                  )}
                </div>
                <div className={styles.detailInfoDesc}>
                  {panelIsHost
                    ? panelHostCleanDesc ||
                      panelHostMemberNames.join("、") ||
                      t("agent.noDescription")
                    : panelAgent.description || t("agent.noDescription")}
                </div>
                {panelIsHost && (
                  <div className={styles.detailHostBadgeRow}>
                    {panelHostModeLabel && (
                      <span className={styles.agentModeTag}>
                        {panelHostModeLabel}
                      </span>
                    )}
                    {panelHostMemberNames.length > 0 && (
                      <span className={styles.hostMemberCountPill}>
                        {panelHostMemberNames.slice(0, 3).join("、")}
                        {panelHostMemberNames.length > 3
                          ? ` 等 ${panelHostMemberNames.length} 人`
                          : `（${panelHostMemberNames.length} 人）`}
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={styles.detailInfoMeta}
                  onClick={(e) => e.stopPropagation()}
                >
                  <GroupTag
                    group={panelAgent.group}
                    onSave={(next) => handleGroupChange(panelAgent.id, next)}
                  />
                </div>
              </div>
            </div>

            {/* Quick actions: 新增聊天 / 历史会话 */}
            <div className={styles.quickActions}>
              <button
                type="button"
                className={styles.quickActionButton}
                onClick={handleNewChat}
              >
                <MessageSquarePlus size={16} />
                <span>{t("chat.newChat", "新增聊天")}</span>
              </button>
              <button
                type="button"
                className={styles.quickActionButton}
                onClick={handleHistorySessions}
              >
                <History size={16} />
                <span>{t("chat.historySessions", "历史会话")}</span>
              </button>
            </div>

            <Divider className={styles.detailDivider} />

            {/* Feature grid — 基本信息 + 控制 + 工作区 */}
            <div className={styles.detailScrollArea}>
              <div className={styles.featureGrid}>
              {featureGroups.profile.length > 0 && (
                <>
                  <div className={styles.featureGroupHeader}>
                    {t("agent.basicInfoGroup", "基本信息")}
                  </div>
                  <div className={styles.featureCards}>
                    {featureGroups.profile.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        className={styles.featureCard}
                        onClick={() => handleProfileCardClick(card)}
                      >
                        <span className={styles.featureCardIcon}>
                          {card.icon}
                        </span>
                        <span className={styles.featureCardLabel}>
                          {card.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {panelIsHost && (
                <>
                  <div className={styles.featureGroupHeader}>
                    {t("hostModal.groupManagement", "群聊管理")}
                  </div>
                  <div className={styles.featureCards}>
                    <button
                      type="button"
                      className={styles.featureCard}
                      onClick={() => setEditGroupAgent(panelAgent)}
                    >
                      <span className={styles.featureCardIcon}>
                        <Users2 size={FEATURE_ICON_SIZE} />
                      </span>
                      <span className={styles.featureCardLabel}>
                        {t("hostModal.editTitle", "编辑群聊")}
                      </span>
                    </button>
                  </div>
                </>
              )}
              {featureGroups.control.length > 0 && (
                <>
                  <div className={styles.featureGroupHeader}>控制</div>
                  <div className={styles.featureCards}>
                    {featureGroups.control.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        className={styles.featureCard}
                        onClick={() => handleFeatureClick(card)}
                      >
                        <span className={styles.featureCardIcon}>
                          {card.icon}
                        </span>
                        <span className={styles.featureCardLabel}>
                          {card.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              {featureGroups.workspace.length > 0 && (
                <>
                  <div className={styles.featureGroupHeader}>工作区</div>
                  <div className={styles.featureCards}>
                    {featureGroups.workspace.map((card) => (
                      <button
                        key={card.key}
                        type="button"
                        className={styles.featureCard}
                        onClick={() => handleFeatureClick(card)}
                      >
                        <span className={styles.featureCardIcon}>
                          {card.icon}
                        </span>
                        <span className={styles.featureCardLabel}>
                          {card.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
              </div>
            </div>
          </div>
        ) : (
          /* ── State A: Agent List ── */
          <div className={styles.agentList}>
            {/* Top bar */}
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>AIArb</span>
              <div className={styles.panelHeaderActions}>
                <Input
                  allowClear
                  size="small"
                  className={styles.agentSearchBox}
                  prefix={<Search size={14} />}
                  placeholder={t(
                    "agentSearch.placeholder",
                    "搜索名称/ID/简介",
                  )}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Tabs: 智能体 / 群聊 */}
            <div className={styles.listTabs}>
              <button
                type="button"
                className={`${styles.listTab}${
                  listTab === "agents" ? ` ${styles.listTabActive}` : ""
                }`}
                onClick={() => setListTab("agents")}
              >
                {t("nav.agents", "智能体")}
              </button>
              <button
                type="button"
                className={`${styles.listTab}${
                  listTab === "groups" ? ` ${styles.listTabActive}` : ""
                }`}
                onClick={() => setListTab("groups")}
              >
                {t("nav.groups", "群聊")}
              </button>
            </div>

            {/* List content */}
            <div className={styles.listContent}>
              {listTab === "agents" && (
                <div className={styles.groupsToolbar}>
                  <button
                    type="button"
                    className={styles.newGroupButton}
                    onClick={() => setCreateAgentOpen(true)}
                    title={t("agent.createTitle", "新建智能体")}
                  >
                    <Plus size={14} />
                    {t("agent.createShort", "智能体")}
                  </button>
                </div>
              )}

              {listTab === "agents" &&
                renderGroupedList(
                  regularGrouped,
                  t("agent.noAgents", "暂无智能体"),
                  false,
                )}

              {listTab === "groups" && (
                <div className={styles.groupsToolbar}>
                  <button
                    type="button"
                    className={styles.newGroupButton}
                    onClick={() => setCreateGroupOpen(true)}
                    title={t("hostModal.title", "新建群聊")}
                  >
                    <Plus size={14} />
                    <Users2 size={14} />
                    {t("hostModal.cta", "群聊")}
                  </button>
                </div>
              )}

              {listTab === "groups" &&
                renderGroupedList(
                  hostGrouped,
                  t("hostModal.empty", "暂无群聊"),
                  true,
                )}
            </div>
          </div>
        )
        )}
      </section>

      {/* ── Middle panel collapse toggle (independent, floats above all) ──── */}
      <button
        type="button"
        className={styles.middleToggle}
        onClick={handleMiddleToggle}
        title={
          middleCollapsed
            ? t("common.expand", "展开")
            : t("common.collapse", "收起")
        }
      >
        {middleCollapsed ? (
          <ChevronRight size={16} />
        ) : (
          <ChevronLeft size={16} />
        )}
      </button>

      {/* ── Column 3: Content ────────────────────────────────────────────────── */}
      <Layout.Content className={styles.content}>
        <ConsolePollService />
        <AgentStatusPollingController />
        <Slot name="content.statusBar" kind="fill" />
        <div className="page-content">
          <ChunkErrorBoundary resetKey={currentPath} canRestartRuntime={hubMode}>
            <Suspense
              fallback={
                <Spin
                  tip={t("common.loading")}
                  style={{ display: "block", margin: "20vh auto" }}
                />
              }
            >
              <Routes>
                {renderableRoutes.map((r) => (
                  <Route
                    key={r.id}
                    path={r.path}
                    element={<r.Component />}
                  />
                ))}
              </Routes>
            </Suspense>
          </ChunkErrorBoundary>
        </div>
      </Layout.Content>

      <CreateGroupChatModal
        open={createGroupOpen}
        onCancel={() => setCreateGroupOpen(false)}
        navigate={navigate}
      />

      <EditGroupChatModal
        open={Boolean(editGroupAgent)}
        agent={editGroupAgent}
        onCancel={() => setEditGroupAgent(null)}
        onSaved={refreshAgents}
      />

      <CreateAgentModal
        open={createAgentOpen}
        onCancel={() => setCreateAgentOpen(false)}
        onCreated={(agentId) => {
          setSelectedAgent(agentId);
          navigate(buildChatPath());
        }}
      />

      <AgentDetailDrawer
        open={Boolean(drawerAgent)}
        agent={drawerAgent}
        initialTab={drawerTab}
        onClose={() => setDrawerAgent(null)}
        onUpdated={refreshAgents}
      />
    </div>
  );
}
