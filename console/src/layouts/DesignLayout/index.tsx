import { Suspense, useEffect, useMemo, useState, useRef } from "react";
import type { ReactNode } from "react";
import { Layout, Tooltip, Badge, Avatar, Spin, Divider, Popover, Popconfirm } from "antd";
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
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Search,
  Users2,
  Plus,
  Pencil,
  Trash2,
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
import { agentsApi } from "../../api/modules/agents";
import { useAppMessage } from "../../hooks/useAppMessage";
import { purgeAgentSpace } from "../../os/osCleanup";
import {
  HOST_MODE_LABEL,
  isHostAgent,
  parseHostMeta,
  stripHostMeta,
} from "../../utils/hostAgent";
import styles from "./designLayout.module.less";

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
  const [listTab, setListTab] = useState<"agents" | "groups">("agents");
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
    removeAgent,
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
    const workspaceGroup = agentMenu.find(
      (i) => i.id === "core.workspace-group",
    ) as TreeMenuItem | undefined;
    for (const child of workspaceGroup?.__children ?? []) {
      if (child.id === "core.inbox" || child.id === "core.marketplace") continue;
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

    return { control, workspace };
  }, [agentMenu, routes]);

  // ── Derived: panel agent object ────────────────────────────────────────────
  const panelAgent = agents.find((a) => a.id === panelAgentId) ?? null;

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
    setSelectedAgent(agent.id);
    navigate(buildChatPath());
  };

  const handleEditGroup = (agent: AgentSummary) => {
    setEditGroupAgent(agent);
  };

  const handleDeleteGroup = async (agent: AgentSummary) => {
    try {
      await agentsApi.deleteAgent(agent.id);
      purgeAgentSpace(agent.id);
      removeAgent(agent.id);
      message.success(t("agent.deleteSuccess", "删除成功"));
      await refreshAgents();
    } catch (err: unknown) {
      message.error(
        err instanceof Error ? err.message : t("agent.deleteFailed", "删除失败"),
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
              <Avatar
                size={40}
                style={{
                  backgroundColor: "var(--color-primary)",
                  flexShrink: 0,
                }}
              >
                {getInitials(panelAgent.name)}
              </Avatar>
              <div className={styles.detailInfoText}>
                <div className={styles.detailInfoName}>{panelAgent.name}</div>
                <div className={styles.detailInfoDesc}>
                  {panelAgent.description || t("agent.noDescription")}
                </div>
              </div>
            </div>

            <Divider className={styles.detailDivider} />

            {/* Feature grid — Control + Workspace */}
            <div className={styles.detailScrollArea}>
              <div className={styles.featureGrid}>
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
                <button type="button" className={styles.panelSearchButton}>
                  <Search size={18} />
                </button>
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
              {listTab === "agents" &&
                (regularAgents.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t("agent.noAgents", "暂无智能体")}
                  </div>
                ) : (
                  regularAgents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      className={styles.agentItem}
                      onClick={() => handleAgentClick(agent)}
                    >
                      <div className={styles.agentAvatar}>
                        <Avatar
                          size={40}
                          style={{
                            backgroundColor: "var(--color-primary)",
                          }}
                        >
                          {getInitials(agent.name)}
                        </Avatar>
                        <span
                          className={styles.agentStatusDot}
                          style={{
                            backgroundColor:
                              STATUS_COLORS[
                                agent.startup_status ?? "disabled"
                              ],
                          }}
                        />
                      </div>
                      <div className={styles.agentInfo}>
                        <div className={styles.agentInfoRow}>
                          <span className={styles.agentName}>
                            {agent.name}
                          </span>
                          {!agent.enabled && (
                            <span className={styles.agentTime}>
                              {t("agent.disabled", "已禁用")}
                            </span>
                          )}
                        </div>
                        <div className={styles.agentDesc}>
                          {agent.description || t("agent.noDescription")}
                        </div>
                      </div>
                    </button>
                  ))
                ))}

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
                (hostAgents.length === 0 ? (
                  <div className={styles.emptyState}>
                    {t("hostModal.empty", "暂无群聊")}
                  </div>
                ) : (
                  hostAgents.map((agent) => {
                    const meta = parseHostMeta(agent);
                    const modeLabel = meta ? HOST_MODE_LABEL[meta.mode] : "";
                    const memberNames = meta
                      ? meta.members.map((m) => m.name)
                      : [];
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
                            style={{
                              backgroundColor: "var(--color-primary)",
                            }}
                          >
                            <Users2 size={18} />
                          </Avatar>
                          <span className={styles.hostAvatarStackMini}>
                            {memberCount || "?"}
                          </span>
                        </div>
                        <div className={styles.agentInfo}>
                          <div className={styles.agentInfoRow}>
                            <span className={styles.agentName}>
                              {agent.name}
                            </span>
                            <span className={styles.agentItemHostBadge}>
                              <Users2 size={10} />
                              {t("hostModal.badge", "群聊")}
                            </span>
                          </div>
                          {modeLabel && (
                            <div className={styles.agentModeTag}>
                              {modeLabel}
                            </div>
                          )}
                          <div className={styles.agentDesc}>
                            {cleanDesc ||
                              memberNames.join("、") ||
                              t("agent.noDescription")}
                          </div>
                          {memberCount > 0 && (
                            <div className={styles.hostMemberCountPill}>
                              {memberNames.slice(0, 3).join("、")}
                              {memberCount > 3
                                ? ` 等 ${memberCount} 人`
                                : `（${memberCount} 人）`}
                            </div>
                          )}
                        </div>
                        <div
                          className={styles.hostAgentActions}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Tooltip title={t("hostModal.edit", "编辑")}>
                            <button
                              type="button"
                              className={styles.hostAgentActionButton}
                              aria-label={t("hostModal.edit", "编辑")}
                              onClick={() => handleEditGroup(agent)}
                            >
                              <Pencil size={14} />
                            </button>
                          </Tooltip>
                          <Popconfirm
                            title={t("hostModal.deleteConfirm", "删除这个群聊？")}
                            description={t(
                              "hostModal.deleteConfirmDesc",
                              "删除后主持人及其工作区将被移除，成员智能体不受影响。",
                            )}
                            okText={t("common.delete", "删除")}
                            cancelText={t("common.cancel", "取消")}
                            okButtonProps={{ danger: true }}
                            onConfirm={() => handleDeleteGroup(agent)}
                          >
                            <Tooltip title={t("hostModal.delete", "删除")}>
                              <button
                                type="button"
                                className={styles.hostAgentActionButton}
                                aria-label={t("hostModal.delete", "删除")}
                              >
                                <Trash2 size={14} />
                              </button>
                            </Tooltip>
                          </Popconfirm>
                        </div>
                      </div>
                    );
                  })
                ))}
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
      />
    </div>
  );
}
