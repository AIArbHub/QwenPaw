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
  Search,
  Users2,
  Plus,
  Info,
  Sparkles,
  Zap,
  Tag,
  ChevronDown,
  Pin,
  PinOff,
  Power,
  PowerOff,
  Files,
  BookOpen,
  NotebookPen,
  Settings,
} from "lucide-react";
import {
  SparkSettingLine,
  SparkMenuExpandLine,
  SparkMenuFoldLine,
} from "@agentscope-ai/icons";
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
import { chatApi } from "../../api/modules/chat";
import { getApiUrl } from "../../api/config";
import type { ChatSpec } from "../../api/types/chat";
import { useAppMessage } from "../../hooks/useAppMessage";
import {
  HOST_MODE_LABEL,
  isHostAgent,
  parseHostMeta,
  stripHostMeta,
} from "../../utils/hostAgent";
import styles from "./designLayout.module.less";
import { AgentDetailDrawer } from "../../pages/Settings/Agents/components";
// 已隐藏：多标签页栏和实验性工作台 — A1 架构已采纳。
// 如需恢复，取消下方导入注释。
// import ChatTabsBar from "../../components/ChatTabsBar";
// import { useChatWorkspaceStore } from "../../pages/Experimental/chatWorkspaceStore";

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

/** Resolve a backend avatar path into a full URL for <img src>. */
function resolveAgentAvatar(avatar?: string | null): string {
  if (!avatar) return "";
  if (/^https?:\/\//.test(avatar)) return avatar;
  const path = avatar.replace(/^\/api/, "");
  return getApiUrl(path);
}

interface SessionSearchHit {
  agentId: string;
  agentName: string;
  chatId: string;
  name: string;
  updatedAt?: string | null;
}

/**
 * 分组标签：展示当前分组，点击后内联编辑并保存。
 * 通过 onSave 回调把新值持久化到后端。
 */
function GroupTag({
  group,
  options,
  onSave,
}: {
  group?: string;
  options: string[];
  onSave: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(group || "");

  useEffect(() => {
    setDraft(group || "");
  }, [group]);

  const confirm = (next: string) => {
    setOpen(false);
    onSave(next);
  };

  const handleConfirm = () => {
    confirm(draft);
  };

  const label = (group || "").trim();
  const existingOptions = options.filter(
    (opt) => opt && opt !== label,
  );

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
          {existingOptions.length > 0 && (
            <div className={styles.groupEditOptions}>
              {existingOptions.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={styles.groupEditOption}
                  onClick={() => confirm(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
          <div className={styles.groupEditInputRow}>
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
  const [sessionHits, setSessionHits] = useState<SessionSearchHit[]>([]);
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
  const rawBottomMenu = useMenuItems("primary.bottom");

  const currentPath = location.pathname;
  const isChatActive =
    currentPath.startsWith("/chat") ||
    currentPath.startsWith("/groups/");
  // 多实例聊天工作台：激活时，中间面板的新建聊天 / 打开会话
  // 操作会在工作台 store 中打开标签页，而不是路由到遗留的
  // 单聊天 `/chat/*` 页面。
  // 已隐藏：A1 架构已采纳 — 工作台始终为非激活状态。
  const isWorkspaceActive = false;
  const agentsManagePath = routeIdToPath("core.agents", routes) ?? "/agents";

// 多实例宿主标签页治理。
// 已隐藏：useChatWorkspaceStore 导入已注释（A1 架构已采纳）。
// const openWorkspaceTab = useChatWorkspaceStore((s) => s.openTab);
// Noop 占位符，使 `if (isWorkspaceActive)` 分支能通过类型检查
// （它们是死代码 — isWorkspaceActive 始终为 false）。
const openWorkspaceTab = (_agentId: string, _chatId?: string, _title?: string) => {};

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

    // (Inbox is rendered in the bottom toolbar — same as full-mode Sidebar.)

    // 2. Memory center (global entry in design mode)
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

    // 3. Shared knowledge base (global entry in design mode)
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

    // 4. Global Settings group header (hidden when collapsed)
    items.push({
      key: "settings-group-header",
      icon: null,
      label: t("nav.globalSettings", "全局设置"),
      isGroupHeader: true,
    });

    // 5. Settings items — when collapsed only the 4 primary entries remain
    // (agents / models / skill-pool / token-usage); expanded shows all.
    const settingsFlat = flattenMenu(rawSettingsMenu, routes, RAIL_ICON_SIZE);
    const collapsedSettings = new Set([
      "core.agents",
      "core.models",
      "core.skill-pool",
      "core.token-usage",
    ]);
    for (const entry of settingsFlat) {
      if (railCollapsed && !collapsedSettings.has(entry.key)) continue;
      items.push({
        key: entry.key,
        icon: entry.icon,
        label: entry.label,
        path: entry.path,
        href: entry.href,
      });
    }

    return items;
  }, [rawAgentMenu, rawBottomMenu, rawSettingsMenu, routes, t, railCollapsed]);

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
    // diary/workspace-files/specific-kb route into the right content panel).
    const profile: FeatureCardData[] = [
      { key: "basic", icon: <Info size={FEATURE_ICON_SIZE} />, label: t("agent.basicInfo", "基本信息") },
      { key: "persona", icon: <Sparkles size={FEATURE_ICON_SIZE} />, label: t("nav.agentFilesPersona", "灵魂人设") },
      {
        key: "diary",
        icon: <NotebookPen size={FEATURE_ICON_SIZE} />,
        label: t("nav.agentFilesDiary", "日记"),
        path: routeIdToPath("core.agent-files-diary", routes),
      },
      {
        key: "workspace-files",
        icon: <Files size={FEATURE_ICON_SIZE} />,
        label: t("nav.agentFilesWorkspace", "工作区文件"),
        path: routeIdToPath("core.agent-files-workspace", routes),
      },
      {
        key: "specific-kb",
        icon: <BookOpen size={FEATURE_ICON_SIZE} />,
        label: t("nav.agentFilesSpecificKB", "专属知识库"),
        path: routeIdToPath("core.agent-files-kb", routes),
      },
      {
        key: "skills",
        icon: <Zap size={FEATURE_ICON_SIZE} />,
        label: t("nav.skills", "技能"),
        path: routeIdToPath("core.skills", routes),
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
  const panelAvatarSrc = resolveAgentAvatar(panelAgent?.avatar);

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

  // 已有分组（去重），用于分组标签快速选取。
  const existingGroups = useMemo(() => {
    const set = new Set<string>();
    for (const agent of agents) {
      const g = (agent.group || "").trim();
      if (g) set.add(g);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [agents]);

  // ── Effects ─────────────────────────────────────────────────────────────────

  // Load agents on mount
  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  // 全量会话搜索：在搜索框输入时，按标题/ID 检索所有智能体的会话。
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      setSessionHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const hits: SessionSearchHit[] = [];
      try {
        for (const agent of agents) {
          if (cancelled) return;
          let chats: ChatSpec[];
          try {
            chats = await chatApi.listChats({
              archived: false,
              include_app_owned: false,
              agent_id: agent.id,
            });
          } catch {
            continue;
          }
          if (cancelled) return;
          for (const chat of chats) {
            const name = (chat.name || "").toLowerCase();
            if (name.includes(q) || (chat.id || "").toLowerCase().includes(q)) {
              hits.push({
                agentId: agent.id,
                agentName: agent.name,
                chatId: chat.id,
                name: chat.name || "New Chat",
                updatedAt: chat.updated_at,
              });
            }
          }
        }
        if (!cancelled) {
          hits.sort((a, b) =>
            (b.updatedAt || "").localeCompare(a.updatedAt || ""),
          );
          setSessionHits(hits);
        }
      } catch {
        if (!cancelled) setSessionHits([]);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, agents]);

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
    // 同时右栏跳转到该群聊的聊天页；若处于多实例工作台则打开新标签。
    setPanelAgentId(agent.id);
    setSelectedAgent(agent.id);
    if (isWorkspaceActive) {
      openWorkspaceTab(agent.id, undefined, "新对话");
      return;
    }
    navigate(buildChatPath());
  };

  const handleOpenDrawer = (agent: AgentSummary, tab: string) => {
    setDrawerAgent(agent);
    setDrawerTab(tab);
  };

  // 新增聊天：若处于多实例工作台则在工作台 store 打开新标签，
  // 否则若已在聊天页派发事件创建新会话，反之跳转 /chat。
  const handleNewChat = () => {
    if (isWorkspaceActive) {
      openWorkspaceTab(selectedAgent, undefined, "新对话");
      return;
    }
    const onChatPage = currentPath.startsWith("/chat");
    if (onChatPage) {
      window.dispatchEvent(new CustomEvent("aiarb:sidebar-new-chat"));
    } else {
      sessionStorage.setItem("aiarb_pending_new_chat", "1");
      navigate(buildChatPath());
    }
  };

  // 历史会话：在右栏打开原生聊天历史面板（与右栏「聊天历史」一致）。
  // 若已在聊天页则直接触发面板，否则跳转聊天页后由 Chat 页处理待打开标记。
  const openHistoryPanel = () => {
    if (currentPath.startsWith("/chat")) {
      window.dispatchEvent(new CustomEvent("aiarb:open-history-panel"));
    } else {
      sessionStorage.setItem("aiarb_pending_open_history", "1");
      navigate(buildChatPath());
    }
  };

  const handleHistorySessions = () => {
    if (panelAgent) {
      setSelectedAgent(panelAgent.id);
    }
    openHistoryPanel();
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

  // 中栏快捷操作：上线 / 下线（切换 enabled）。
  const handleToggleEnabled = async (agent: AgentSummary) => {
    const next = !agent.enabled;
    try {
      await agentsApi.toggleAgentEnabled(agent.id, next);
      updateAgent(agent.id, { enabled: next });
      message.success(
        next
          ? t("agent.enableSuccess", "已启用")
          : t("agent.disableSuccess", "已停用"),
      );
    } catch (err: unknown) {
      message.error(
        err instanceof Error
          ? err.message
          : t("agent.enableToggleFailed", "操作失败"),
      );
    }
  };

  // 中栏快捷操作：置顶 / 取消置顶。
  const handleTogglePin = async (agent: AgentSummary) => {
    const next = !agent.pinned;
    try {
      await agentsApi.setAgentPinned(agent.id, next);
      updateAgent(agent.id, { pinned: next });
    } catch (err: unknown) {
      message.error(
        err instanceof Error ? err.message : t("agent.pinFailed", "置顶失败"),
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
  // 处于多实例工作台时，明确用「被悬停的智能体」在工作台打开新标签，
  // 而不是依赖全局 selectedAgent，避免点 A 却建 B 的串扰。
  const handleAgentNewChat = (agent: AgentSummary) => {
    setSelectedAgent(agent.id);
    if (isWorkspaceActive) {
      openWorkspaceTab(agent.id, undefined, "新对话");
      return;
    }
    handleNewChat();
  };

  // 进入该智能体/群聊的会话历史面板（右栏原生聊天历史）。
  const handleAgentHistory = (agent: AgentSummary) => {
    setSelectedAgent(agent.id);
    openHistoryPanel();
  };

  // 从搜索结果进入某个智能体的具体会话；若处于多实例工作台则在工作台打开该会话标签。
  const handleSessionHitClick = (hit: SessionSearchHit) => {
    setSelectedAgent(hit.agentId);
    if (isWorkspaceActive) {
      openWorkspaceTab(hit.agentId, hit.chatId, hit.name);
      return;
    }
    navigate(buildChatPath(hit.chatId));
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
  // 注意：`items` 在此应为已经过滤（搜索）后的数据。
  const groupByGroupName = (
    items: AgentSummary[],
    prefix: string,
  ): Array<{ key: string; label: string; items: AgentSummary[] }> => {
    const src = items;
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

  // 先对输入做搜索过滤，再把「置顶」的智能体从各自分组抽出，
  // 作为最顶部的「置顶」分组排在所有普通分组之前。
  const composeGrouped = (
    items: AgentSummary[],
    prefix: string,
  ): Array<{ key: string; label: string; items: AgentSummary[] }> => {
    const src = filterByQuery(items);
    const pinnedLabel = t("agent.pinnedGroup", "置顶");
    const pinned = src.filter((a) => a.pinned && a.id !== "default");
    const rest = src.filter((a) => !(a.pinned && a.id !== "default"));
    const pinnedGroup: Array<{
      key: string;
      label: string;
      items: AgentSummary[];
    }> = pinned.length
      ? [{ key: `${prefix}:pinned`, label: pinnedLabel, items: pinned }]
      : [];
    return [...pinnedGroup, ...groupByGroupName(rest, prefix)];
  };

  const regularGrouped = useMemo(
    () => composeGrouped(regularAgents, "ag"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regularAgents, searchQuery],
  );
  const hostGrouped = useMemo(
    () => composeGrouped(hostAgents, "gr"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostAgents, searchQuery],
  );

  // 分组下每个条目的 hover 快捷操作：上线/下线 + 置顶 + 新增对话 + 对话历史。
  const renderQuickActions = (agent: AgentSummary): ReactNode => (
    <div
      className={styles.hostAgentActions}
      onClick={(e) => e.stopPropagation()}
    >
      {agent.id !== "default" && (
        <>
          <Tooltip title={agent.enabled ? t("agent.disable", "停用") : t("agent.enable", "启用")}>
            <button
              type="button"
              className={styles.hostAgentActionButton}
              aria-label={agent.enabled ? t("agent.disable", "停用") : t("agent.enable", "启用")}
              onClick={() => handleToggleEnabled(agent)}
            >
              {agent.enabled ? <Power size={14} /> : <PowerOff size={14} />}
            </button>
          </Tooltip>
          <Tooltip title={agent.pinned ? t("agent.unpinAgent", "取消置顶") : t("agent.pinAgent", "置顶")}>
            <button
              type="button"
              className={styles.hostAgentActionButton}
              aria-label={agent.pinned ? t("agent.unpinAgent", "取消置顶") : t("agent.pinAgent", "置顶")}
              onClick={() => handleTogglePin(agent)}
            >
              {agent.pinned ? <Pin size={14} /> : <PinOff size={14} />}
            </button>
          </Tooltip>
        </>
      )}
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
  const renderAgentItem = (agent: AgentSummary): ReactNode => {
    const avatarSrc = resolveAgentAvatar(agent.avatar);
    return (
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
          {avatarSrc ? (
            <Avatar size={40} src={avatarSrc} />
          ) : (
            <Avatar
              size={40}
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {getInitials(agent.name)}
            </Avatar>
          )}
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
        </div>
        {renderQuickActions(agent)}
      </div>
    );
  };

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

  // 搜索结果中的会话条目。
  const renderSessionHitItem = (hit: SessionSearchHit): ReactNode => (
    <div
      key={`${hit.agentId}:${hit.chatId}`}
      className={styles.agentItem}
      role="button"
      tabIndex={0}
      onClick={() => handleSessionHitClick(hit)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleSessionHitClick(hit);
        }
      }}
    >
      <div className={styles.agentAvatar}>
        <Avatar
          size={40}
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <MessageSquareText size={18} />
        </Avatar>
      </div>
      <div className={styles.agentInfo}>
        <div className={styles.agentInfoRow}>
          <span className={styles.agentName}>{hit.name}</span>
        </div>
        <div className={styles.agentDesc}>{hit.agentName}</div>
      </div>
    </div>
  );

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
        {/* Logo: collapsed → "A" letter, expanded → full SVG logo */}
        <div className={styles.railLogo}>
          {railCollapsed ? (
            <span>A</span>
          ) : (
            <img
              src={isDark ? "/logo-dark.svg" : "/logo-light.svg"}
              alt="AI Arb"
              className={styles.railLogoImg}
            />
          )}
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

        {/* Bottom controls (fixed) — mirrors full-mode Sidebar layout */}
        <div className={styles.railBottom}>
          {/* Inbox button — from primary.bottom toolbar */}
          {(() => {
            const inboxEntry = flattenMenu(rawBottomMenu, routes, RAIL_ICON_SIZE).find(
              (e) => e.key === "core.inbox",
            );
            if (!inboxEntry) return null;
            const isActive = selectedKey === inboxEntry.key;
            return (
              <Tooltip
                title={inboxEntry.label}
                placement={railCollapsed ? "right" : "top"}
                styles={{
                  body: {
                    background: "rgba(0,0,0,0.75)",
                    color: "#fff",
                  },
                }}
              >
                <button
                  type="button"
                  className={`${styles.railBottomButton}${
                    isActive ? ` ${styles.railMenuItemActive}` : ""
                  }`}
                  onClick={() => {
                    if (inboxEntry.href) {
                      window.open(inboxEntry.href, "_blank", "noopener,noreferrer");
                    } else {
                      navigate(inboxEntry.path);
                    }
                  }}
                >
                  {inboxEntry.icon}
                </button>
              </Tooltip>
            );
          })()}
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement={railCollapsed ? "rightBottom" : "topRight"}
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
              <SparkSettingLine size={RAIL_ICON_SIZE} />
            </button>
          </Popover>
          <Tooltip
            title={railCollapsed ? t("common.expand") : t("common.collapse")}
            placement={railCollapsed ? "right" : "top"}
          >
            <button
              type="button"
              className={styles.railBottomButton}
              onClick={() => setRailCollapsed((prev) => !prev)}
            >
              {railCollapsed ? (
                <SparkMenuExpandLine size={RAIL_ICON_SIZE} />
              ) : (
                <SparkMenuFoldLine size={RAIL_ICON_SIZE} />
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
              <div className={styles.detailHeaderActions}>
                {panelAgent.id !== "default" && (
                  <>
                    <Tooltip
                      title={
                        panelAgent.enabled
                          ? t("agent.disable", "停用")
                          : t("agent.enable", "启用")
                      }
                    >
                      <button
                        type="button"
                        className={styles.hostAgentActionButton}
                        aria-label={
                          panelAgent.enabled
                            ? t("agent.disable", "停用")
                            : t("agent.enable", "启用")
                        }
                        onClick={() => handleToggleEnabled(panelAgent)}
                      >
                        {panelAgent.enabled ? (
                          <Power size={14} />
                        ) : (
                          <PowerOff size={14} />
                        )}
                      </button>
                    </Tooltip>
                    <Tooltip
                      title={
                        panelAgent.pinned
                          ? t("agent.unpinAgent", "取消置顶")
                          : t("agent.pinAgent", "置顶")
                      }
                    >
                      <button
                        type="button"
                        className={styles.hostAgentActionButton}
                        aria-label={
                          panelAgent.pinned
                            ? t("agent.unpinAgent", "取消置顶")
                            : t("agent.pinAgent", "置顶")
                        }
                        onClick={() => handleTogglePin(panelAgent)}
                      >
                        {panelAgent.pinned ? <Pin size={14} /> : <PinOff size={14} />}
                      </button>
                    </Tooltip>
                  </>
                )}
              </div>
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
              ) : panelAvatarSrc ? (
                <Avatar
                  size={40}
                  src={panelAvatarSrc}
                  style={{ flexShrink: 0 }}
                />
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
                    options={existingGroups}
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
            {/* Tabs: 智能体 / 群聊 */}
            <div className={styles.listTabs}>
              <button
                type="button"
                className={`${styles.listTab}${
                  listTab === "agents" ? ` ${styles.listTabActive}` : ""
                }`}
                onClick={() => setListTab("agents")}
              >
                {t("agent.agents", "智能体")}
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

            {/* Search + create/manage toolbar (below tabs) */}
            <div className={styles.listToolbar}>
              <Input
                allowClear
                className={styles.agentSearchBox}
                prefix={<Search size={14} />}
                placeholder={t(
                  "agentSearch.placeholder",
                  "搜索智能体 / 会话",
                )}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {listTab === "agents" ? (
                <Tooltip title={t("agent.management", "智能体管理")}>
                  <button
                    type="button"
                    className={styles.manageLinkButton}
                    aria-label={t("agent.management", "智能体管理")}
                    onClick={() => navigate(`${agentsManagePath}?type=single`)}
                  >
                    <Settings size={14} />
                  </button>
                </Tooltip>
              ) : (
                <Tooltip title={t("hostModal.manage", "群聊智能体管理")}>
                  <button
                    type="button"
                    className={styles.manageLinkButton}
                    aria-label={t("hostModal.manage", "群聊智能体管理")}
                    onClick={() => navigate(`${agentsManagePath}?type=group`)}
                  >
                    <Settings size={14} />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* List content */}
            <div className={styles.listContent}>
              {queryNorm && sessionHits.length > 0 && (
                <div className={styles.sessionSearchSection}>
                  <div className={styles.searchSectionHeader}>
                    {t("agentSearch.sessions", "会话")}
                    <span className={styles.groupHeaderCount}>
                      {sessionHits.length}
                    </span>
                  </div>
                  {sessionHits.map(renderSessionHitItem)}
                </div>
              )}

              {listTab === "agents" &&
                renderGroupedList(
                  regularGrouped,
                  t("agent.noAgents", "暂无智能体"),
                  false,
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
        {/* 已隐藏：多标签页栏 — A1 架构已采纳，标签页暂时隐藏。
             如需恢复，取消下方 ChatTabsBar 导入和渲染的注释。 */}
        {/* <ChatTabsBar /> */}
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
