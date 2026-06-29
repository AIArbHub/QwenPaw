import {
  Layout,
  Menu,
  Button,
  Modal,
  Input,
  Form,
  Tooltip,
  Badge,
  Popover,
} from "antd";
import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppMessage } from "../hooks/useAppMessage";
import AgentSelector from "../components/AgentSelector";
import {
  SparkChatTabFill,
  SparkExitFullscreenLine,
  SparkSearchUserLine,
  SparkMenuExpandLine,
  SparkMenuFoldLine,
  SparkEmailLine,
  SparkSettingLine,
  SparkMagicWandLine,
  SparkToolLine,
  SparkMcpMcpLine,
  SparkWifiLine,
  SparkDateLine,
  SparkLocalFileLine,
  SparkAgentLine,
  SparkModePlazaLine,
  SparkInternetLine,
  SparkBrowseLine,
  SparkDataLine,
  SparkSaveLine,
  SparkUserGroupLine,
  SparkVoiceChat01Line,
} from "@agentscope-ai/icons";
import SidebarSessionList from "./SidebarSessionList";
import SidebarSettingsPanel from "./SidebarSettingsPanel";
import { clearAuthToken } from "../api/config";
import { authApi } from "../api/modules/auth";
import api from "../api";
import { useCodingMode } from "../stores/codingModeStore";
import { useSidebarModeStore } from "../stores/sidebarModeStore";
import { buildSessionPath, getSessionIdFromPath } from "../utils/sessionRoute";
import sessionApi from "../pages/Chat/sessionApi";
import styles from "./index.module.less";
import { useTheme } from "../contexts/ThemeContext";
import { useMenuItems, useRoutes } from "../plugins/registry/hooks";
import { Slot } from "../plugins/registry/Slot";
import {
  deriveOpenKeys,
  findMenuItem,
  flattenMenu,
  renderIcon,
  routeIdToPath,
  toAntdItems,
} from "./registry/adapter";
import type { FlatMenuEntry } from "./registry/adapter";
import type { MenuItem } from "../plugins/registry/types";
import type { ReactNode } from "react";

// ── Layout ────────────────────────────────────────────────────────────────

const { Sider } = Layout;
const MOBILE_SIDEBAR_QUERY = "(max-width: 768px)";

function isMobileSidebarViewport() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_SIDEBAR_QUERY).matches
  );
}
const INBOX_BADGE_POLLING_MS = 6000;

// ── Simple mode whitelist ─────────────────────────────────────────────────

/** Menu item IDs that remain visible in simple sidebar mode (no groups). */
const SIMPLE_MODE_WHITELIST = new Set([
  "core.inbox",
  "core.cron-jobs",
  "core.agent-config",
  "core.models",
]);

// ── Design mode menu definition ───────────────────────────────────────────

const DESIGN_MODE_NAV_ITEMS: {
  key: string;
  route: string;
  labelKey: string;
  labelDefault: string;
  icon: React.ComponentType<any>;
  separatorBefore?: boolean;
}[] = [
  { key: "core.chat", route: "core.chat", labelKey: "nav.chat", labelDefault: "Chat", icon: SparkChatTabFill },
  { key: "core.inbox", route: "core.inbox", labelKey: "nav.inbox", labelDefault: "Inbox", icon: SparkEmailLine },
  { key: "design.skills", route: "design.skills", labelKey: "nav.skills", labelDefault: "Skills", icon: SparkMagicWandLine, separatorBefore: true },
  { key: "core.tools", route: "core.tools", labelKey: "nav.tools", labelDefault: "Tools", icon: SparkToolLine },
  { key: "design.extensions", route: "design.extensions", labelKey: "nav.extensions", labelDefault: "Extensions", icon: SparkMcpMcpLine },
  { key: "core.channels", route: "core.channels", labelKey: "nav.channels", labelDefault: "Channels", icon: SparkWifiLine, separatorBefore: true },
  { key: "core.sessions", route: "core.sessions", labelKey: "nav.sessions", labelDefault: "Sessions", icon: SparkUserGroupLine },
  { key: "core.cron-jobs", route: "core.cron-jobs", labelKey: "nav.cronJobs", labelDefault: "Cron Jobs", icon: SparkDateLine },
  { key: "core.heartbeat", route: "core.heartbeat", labelKey: "nav.heartbeat", labelDefault: "Heartbeat", icon: SparkVoiceChat01Line },
  { key: "core.workspace", route: "core.workspace", labelKey: "nav.workspace", labelDefault: "Files", icon: SparkLocalFileLine, separatorBefore: true },
  { key: "design.agent", route: "design.agent", labelKey: "nav.agents", labelDefault: "Agent", icon: SparkAgentLine, separatorBefore: true },
  { key: "core.models", route: "core.models", labelKey: "nav.models", labelDefault: "Models", icon: SparkModePlazaLine },
  { key: "core.environments", route: "core.environments", labelKey: "nav.environments", labelDefault: "Environments", icon: SparkInternetLine },
  { key: "core.security", route: "core.security", labelKey: "nav.security", labelDefault: "Security", icon: SparkBrowseLine },
  { key: "design.usage", route: "design.usage", labelKey: "nav.usage", labelDefault: "Usage", icon: SparkDataLine },
  { key: "design.ops", route: "design.ops", labelKey: "nav.ops", labelDefault: "Ops", icon: SparkSaveLine },
];

/**
 * Flatten a MenuItem tree into a leaf-only list for simple sidebar mode.
 * Groups are eliminated entirely — only whitelisted children survive
 * as top-level items.
 */
function flattenMenuForSimpleMode(items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = [];
  for (const rawItem of items) {
    const item = rawItem as MenuItem & { __children?: MenuItem[] };
    if (item.__children && item.__children.length > 0) {
      for (const child of item.__children) {
        if (SIMPLE_MODE_WHITELIST.has(child.id)) {
          result.push(child);
        }
      }
    } else if (SIMPLE_MODE_WHITELIST.has(item.id)) {
      result.push(item);
    }
  }
  return result;
}

// ── Types ─────────────────────────────────────────────────────────────────

interface SidebarProps {
  /** Route id of the currently active page (e.g. "core.workspace"). */
  selectedKey: string;
}

// ── Sidebar ───────────────────────────────────────────────────────────────

export default function Sidebar({ selectedKey }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const { message } = useAppMessage();
  const { isDark } = useTheme();
  // When coding mode is on, the sidebar "Chat" entry should land on /coding
  // (FileTree + Editor + Chat panel) rather than the bare Chat page.
  const { codingMode } = useCodingMode();
  const currentSessionId = getSessionIdFromPath(location.pathname);
  const chatPath = buildSessionPath(
    codingMode ? "coding" : "chat",
    currentSessionId,
  );
  const [authEnabled, setAuthEnabled] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountForm] = Form.useForm();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(isMobileSidebarViewport);
  const [hasInboxUnread, setHasInboxUnread] = useState(false);

  // Sidebar mode: "simple" (only core items) or "full" (everything)
  const { mode: sidebarMode } = useSidebarModeStore();

  // Menu + route snapshots from registry (builtin + plugin registrations merged).
  const rawAgentMenu = useMenuItems("primary.agentScoped");
  const rawSettingsMenu = useMenuItems("primary.settings");
  const routes = useRoutes();

  // Apply simple-mode filtering when enabled
  const agentMenu = useMemo(
    () =>
      sidebarMode === "simple"
        ? flattenMenuForSimpleMode(rawAgentMenu)
        : rawAgentMenu,
    [rawAgentMenu, sidebarMode],
  );
  const settingsMenu = useMemo(
    () =>
      sidebarMode === "simple"
        ? flattenMenuForSimpleMode(rawSettingsMenu)
        : rawSettingsMenu,
    [rawSettingsMenu, sidebarMode],
  );

  // Flat nav entries for simple mode (icon + label + path)
  const simpleFlatNav = useMemo(() => {
    if (sidebarMode !== "simple") return [];
    return [
      ...flattenMenu(agentMenu, routes, 16),
      ...flattenMenu(settingsMenu, routes, 16),
    ];
  }, [agentMenu, settingsMenu, routes, sidebarMode]);

  // Flat nav entries for design mode
  const designFlatNav = useMemo(() => {
    if (sidebarMode !== "design") return [];
    return DESIGN_MODE_NAV_ITEMS.map((item) => {
      let path = routeIdToPath(item.route, routes) ?? "";
      if (item.key === "core.chat") path = chatPath;
      return {
        key: item.key,
        icon: renderIcon(item.icon, 16),
        label: t(item.labelKey, item.labelDefault),
        path,
        separatorBefore: item.separatorBefore,
      };
    });
  }, [routes, sidebarMode, t, chatPath]);

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    authApi
      .getStatus()
      .then((res) => setAuthEnabled(res.enabled))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_SIDEBAR_QUERY);
    const syncMobileSidebar = () => {
      setIsMobile(mediaQuery.matches);
      if (mediaQuery.matches) {
        setCollapsed(true);
      }
    };

    syncMobileSidebar();
    mediaQuery.addEventListener("change", syncMobileSidebar);

    return () => {
      mediaQuery.removeEventListener("change", syncMobileSidebar);
    };
  }, []);
  useEffect(() => {
    const loadUnreadState = async () => {
      try {
        const [inboxRes, pushRes] = await Promise.all([
          api.getInboxEvents({
            unread_only: true,
            limit: 1,
          }),
          api.getPushMessages(),
        ]);
        const hasUnreadEvents = (inboxRes?.events?.length || 0) > 0;
        const hasPendingApprovals =
          (pushRes?.pending_approvals?.length || 0) > 0;
        setHasInboxUnread(hasUnreadEvents || hasPendingApprovals);
      } catch {
        // Keep previous state when polling fails.
      }
    };
    void loadUnreadState();
    const timer = window.setInterval(() => {
      void loadUnreadState();
    }, INBOX_BADGE_POLLING_MS);
    return () => window.clearInterval(timer);
  }, []);

  // ── Adapter: convert MenuItem trees to antd, with inbox badge decoration.

  /** Wrap the inbox label with the unread-Badge while keeping all other labels intact. */
  const decorateLabel = (item: MenuItem, label: ReactNode): ReactNode => {
    if (item.id !== "core.inbox" || label == null) return label;
    return (
      <Badge dot={hasInboxUnread} color="rgba(75, 63, 227, 1)" offset={[5, 7]}>
        <span>{label}</span>
      </Badge>
    );
  };

  const agentMenuItems = useMemo(
    () => toAntdItems(agentMenu, { collapsed, decorateLabel }),
    // hasInboxUnread closure inside decorateLabel — listed as dep explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentMenu, collapsed, hasInboxUnread],
  );

  const settingsMenuItems = useMemo(
    () => toAntdItems(settingsMenu, { collapsed }),
    [settingsMenu, collapsed],
  );

  const openKeys = useMemo(
    () => [...deriveOpenKeys(agentMenu), ...deriveOpenKeys(settingsMenu)],
    [agentMenu, settingsMenu],
  );

  const collapsedNavItems = useMemo(() => {
    // Sticky chat is its own carve-out (lives outside menu data — see builtinMenu.ts).
    const stickyChat: FlatMenuEntry = {
      key: "core.chat",
      icon: <SparkChatTabFill size={18} />,
      path: chatPath,
      label: t("nav.chat"),
    };
    // Inbox in collapsed mode shows a dot overlay on its icon (kept Sidebar-local
    // for the same reason as decorateLabel: live state isn't menu data).
    const decorateInboxIcon = (icon: ReactNode): ReactNode => (
      <span style={{ position: "relative", display: "inline-flex" }}>
        {icon ?? <SparkEmailLine size={18} />}
        {hasInboxUnread && (
          <span
            style={{
              position: "absolute",
              top: -1,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(75, 63, 227, 1)",
            }}
          />
        )}
      </span>
    );
    const flat = [
      stickyChat,
      ...flattenMenu(agentMenu, routes, 18),
      ...flattenMenu(settingsMenu, routes, 18),
    ];
    return flat.map((entry) =>
      entry.key === "core.inbox"
        ? { ...entry, icon: decorateInboxIcon(entry.icon) }
        : entry,
    );
  }, [agentMenu, settingsMenu, routes, chatPath, t, hasInboxUnread]);

  // Collapsed nav items for design mode
  const designCollapsedNavItems = useMemo(() => {
    if (sidebarMode !== "design") return [];
    const decorateInboxIcon = (icon: ReactNode): ReactNode => (
      <span style={{ position: "relative", display: "inline-flex" }}>
        {icon ?? <SparkEmailLine size={18} />}
        {hasInboxUnread && (
          <span
            style={{
              position: "absolute",
              top: -1,
              right: -3,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "rgba(75, 63, 227, 1)",
            }}
          />
        )}
      </span>
    );
    return designFlatNav.map((entry) => ({
      ...entry,
      icon: entry.key === "core.inbox"
        ? decorateInboxIcon(entry.icon)
        : renderIcon(
            DESIGN_MODE_NAV_ITEMS.find((i) => i.key === entry.key)?.icon ??
              SparkSettingLine,
            18,
          ),
    }));
  }, [sidebarMode, designFlatNav, hasInboxUnread]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleMenuClick = (key: string, allItems: MenuItem[]) => {
    const item = findMenuItem(allItems, key);
    if (item?.href) {
      window.open(item.href, "_blank", "noopener,noreferrer");
      return;
    }
    const path = routeIdToPath(item?.route, routes);
    if (path) navigate(path);
  };

  /**
   * New chat: if we're already on the chat page, dispatch the event so
   * ChatSessionInitializer (which is mounted) creates the session.
   * If we're on another page, navigate to /chat without a session id —
   * the chat page will auto-create a new session on mount.
   */
  const handleNewChat = useCallback(() => {
    const onChatPage =
      location.pathname.startsWith("/chat") ||
      location.pathname.startsWith("/coding");
    if (onChatPage) {
      window.dispatchEvent(new CustomEvent("qwenpaw:sidebar-new-chat"));
    } else {
      sessionStorage.setItem("qwenpaw_pending_new_chat", "1");
      const mode = codingMode ? "coding" : "chat";
      navigate(`/${mode}`);
    }
  }, [location.pathname, navigate, codingMode]);

  /**
   * Session click: navigate directly without relying on ChatSessionInitializer.
   * buildSessionPath handles coding-mode paths.
   * Resolve realId (backend UUID) to avoid exposing local timestamp in URL.
   */
  const handleSidebarSessionClick = useCallback(
    (sessionId: string) => {
      const mode = codingMode ? "coding" : "chat";
      const effectiveId = sessionApi.getEffectiveSessionId(sessionId);
      const targetPath = buildSessionPath(mode, effectiveId);
      navigate(targetPath);
    },
    [codingMode, navigate],
  );

  const handleUpdateProfile = async (values: {
    currentPassword: string;
    newUsername?: string;
    newPassword?: string;
  }) => {
    const trimmedUsername = values.newUsername?.trim() || undefined;
    const trimmedPassword = values.newPassword?.trim() || undefined;

    if (values.newPassword && !trimmedPassword) {
      message.error(t("account.passwordEmpty"));
      return;
    }

    if (values.newUsername && !trimmedUsername) {
      message.error(t("account.usernameEmpty"));
      return;
    }

    if (!trimmedUsername && !trimmedPassword) {
      message.warning(t("account.nothingToUpdate"));
      return;
    }

    setAccountLoading(true);
    try {
      await authApi.updateProfile(
        values.currentPassword,
        trimmedUsername,
        trimmedPassword,
      );
      message.success(t("account.updateSuccess"));
      setAccountModalOpen(false);
      accountForm.resetFields();
      clearAuthToken();
      window.location.href = "/login";
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "";
      let msg = t("account.updateFailed");
      if (raw.includes("password is incorrect")) {
        msg = t("account.wrongPassword");
      } else if (raw.includes("Nothing to update")) {
        msg = t("account.nothingToUpdate");
      } else if (raw.includes("cannot be empty")) {
        msg = t("account.nothingToUpdate");
      } else if (raw) {
        msg = raw;
      }
      message.error(msg);
    } finally {
      setAccountLoading(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const siderWidth = collapsed ? (isMobile ? 56 : 72) : 240;
  // Sticky chat is active when on /chat* or /coding routes.
  const isChatActive =
    selectedKey === "core.chat" || selectedKey === "core.coding";
  // `renderIcon` retained for tree-shaking awareness.
  void renderIcon;

  const isSimpleExpanded = sidebarMode === "simple" && !collapsed;
  const isDesignExpanded = sidebarMode === "design" && !collapsed;

  return (
    <Sider
      width={siderWidth}
      className={`${styles.sider}${
        collapsed ? ` ${styles.siderCollapsed}` : ""
      }${isDark ? ` ${styles.siderDark}` : ""}${
        isSimpleExpanded ? ` ${styles.siderSimple}` : ""
      }${isDesignExpanded ? ` ${styles.siderDesign}` : ""}`}
    >
      {collapsed ? (
        <nav className={styles.collapsedNav}>
          {(sidebarMode === "design" ? designCollapsedNavItems : collapsedNavItems).map((item) => {
            const isActive =
              item.key === "core.chat"
                ? isChatActive
                : selectedKey === item.key;
            return (
              <Tooltip
                key={item.key}
                title={item.label}
                placement="right"
                overlayInnerStyle={{
                  background: "rgba(0,0,0,0.75)",
                  color: "#fff",
                }}
              >
                <button
                  className={`${styles.collapsedNavItem} ${
                    isActive ? styles.collapsedNavItemActive : ""
                  }`}
                  onClick={() =>
                    item.href
                      ? window.open(item.href, "_blank", "noopener,noreferrer")
                      : navigate(item.path)
                  }
                >
                  {item.icon}
                </button>
              </Tooltip>
            );
          })}
        </nav>
      ) : isSimpleExpanded ? (
        <>
          {/* Simple mode: flat nav items + session list */}
          <div className={styles.agentScopedSection}>
            <div className={styles.agentSelectorContainer}>
              <AgentSelector collapsed={collapsed} />
            </div>
            {/* Flat nav items (no groups) */}
            <div className={styles.simpleNavItems}>
              {simpleFlatNav.map((entry) => {
                const isInbox = entry.key === "core.inbox";
                const isActive = selectedKey === entry.key;
                return (
                  <button
                    key={entry.key}
                    className={`${styles.simpleNavItem} ${
                      isActive ? styles.simpleNavItemActive : ""
                    }`}
                    onClick={() =>
                      entry.href
                        ? window.open(
                            entry.href,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        : navigate(entry.path)
                    }
                  >
                    {isInbox ? (
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                        }}
                      >
                        {entry.icon ?? <SparkEmailLine size={16} />}
                        {hasInboxUnread && (
                          <span
                            style={{
                              position: "absolute",
                              top: -1,
                              right: -3,
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "rgba(75, 63, 227, 1)",
                            }}
                          />
                        )}
                      </span>
                    ) : (
                      entry.icon
                    )}
                    <span>{entry.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Session list — fills remaining space */}
          <SidebarSessionList
            onNewChat={handleNewChat}
            onSessionClick={handleSidebarSessionClick}
          />
        </>
      ) : isDesignExpanded ? (
        <>
          {/* Design mode: flat nav with separators, no groups */}
          <div className={styles.agentScopedSection}>
            <div className={styles.agentSelectorContainer}>
              <AgentSelector collapsed={collapsed} />
            </div>
            <div className={styles.designNavItems}>
              {designFlatNav.map((entry) => (
                <React.Fragment key={entry.key}>
                  {entry.separatorBefore && (
                    <div className={styles.designSeparator} />
                  )}
                  <button
                    className={`${styles.designNavItem} ${
                      (entry.key === "core.chat"
                        ? isChatActive
                        : selectedKey === entry.key)
                        ? styles.designNavItemActive
                        : ""
                    }`}
                    onClick={() =>
                      entry.path
                        ? navigate(entry.path)
                        : undefined
                    }
                  >
                    {entry.key === "core.inbox" ? (
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                        }}
                      >
                        {entry.icon ?? <SparkEmailLine size={16} />}
                        {hasInboxUnread && (
                          <span
                            style={{
                              position: "absolute",
                              top: -1,
                              right: -3,
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: "rgba(75, 63, 227, 1)",
                            }}
                          />
                        )}
                      </span>
                    ) : (
                      entry.icon
                    )}
                    <span>{entry.label}</span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
          <SidebarSessionList
            onNewChat={handleNewChat}
            onSessionClick={handleSidebarSessionClick}
          />
        </>
      ) : (
        <>
          {/* Agent-scoped section: selector + Chat + Control + Workspace */}
          <div className={styles.agentScopedSection}>
            <div className={styles.agentSelectorContainer}>
              <AgentSelector collapsed={collapsed} />
              {/* Chat entry — sticky together with agent selector */}
              <button
                className={`${styles.stickyChatButton}${
                  isChatActive ? ` ${styles.stickyChatButtonActive}` : ""
                }`}
                onClick={() => navigate(chatPath)}
              >
                <SparkChatTabFill size={16} />
                <span>{t("nav.chat")}</span>
              </button>
            </div>
            <Slot name="sider.top" kind="fill" />
            <Menu
              mode="inline"
              selectedKeys={[selectedKey]}
              openKeys={openKeys}
              onClick={({ key }) => handleMenuClick(String(key), agentMenu)}
              items={agentMenuItems}
              theme={isDark ? "dark" : "light"}
              className={styles.sideMenu}
            />
          </div>

          {/* Global settings section */}
          <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            openKeys={openKeys}
            onClick={({ key }) => handleMenuClick(String(key), settingsMenu)}
            items={settingsMenuItems}
            theme={isDark ? "dark" : "light"}
            className={styles.sideMenu}
          />
          <Slot name="sider.bottom" kind="fill" />
        </>
      )}

      {authEnabled && !collapsed && (
        <div className={styles.authActions}>
          <Button
            type="text"
            icon={<SparkSearchUserLine size={16} />}
            onClick={() => {
              accountForm.resetFields();
              setAccountModalOpen(true);
            }}
            block
            className={`${styles.authBtn} ${
              collapsed ? styles.authBtnCollapsed : ""
            }`}
          >
            {!collapsed && t("account.title")}
          </Button>
          <Button
            type="text"
            icon={<SparkExitFullscreenLine size={16} />}
            onClick={() => {
              clearAuthToken();
              window.location.href = "/login";
            }}
            block
            className={`${styles.authBtn} ${
              collapsed ? styles.authBtnCollapsed : ""
            }`}
          >
            {!collapsed && t("login.logout")}
          </Button>
        </div>
      )}

      <div className={styles.collapseToggleContainer}>
        {!collapsed && (
          <Popover
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            placement="topRight"
            trigger="click"
            content={
              <SidebarSettingsPanel onClose={() => setSettingsOpen(false)} />
            }
          >
            <Button
              type="text"
              icon={<SparkSettingLine size={18} />}
              className={styles.collapseToggle}
            />
          </Popover>
        )}
        <Button
          type="text"
          icon={
            collapsed ? (
              <SparkMenuExpandLine size={20} />
            ) : (
              <SparkMenuFoldLine size={20} />
            )
          }
          onClick={() => setCollapsed(!collapsed)}
          className={styles.collapseToggle}
        />
      </div>

      <Modal
        open={accountModalOpen}
        onCancel={() => setAccountModalOpen(false)}
        title={t("account.title")}
        footer={null}
        destroyOnHidden
        centered
      >
        <Form
          form={accountForm}
          layout="vertical"
          onFinish={handleUpdateProfile}
        >
          <Form.Item
            name="currentPassword"
            label={t("account.currentPassword")}
            rules={[
              { required: true, message: t("account.currentPasswordRequired") },
            ]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="newUsername" label={t("account.newUsername")}>
            <Input placeholder={t("account.newUsernamePlaceholder")} />
          </Form.Item>
          <Form.Item name="newPassword" label={t("account.newPassword")}>
            <Input.Password placeholder={t("account.newPasswordPlaceholder")} />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label={t("account.confirmPassword")}
            dependencies={["newPassword"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value && !getFieldValue("newPassword")) {
                    return Promise.resolve();
                  }
                  if (value === getFieldValue("newPassword")) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("account.passwordMismatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password
              placeholder={t("account.confirmPasswordPlaceholder")}
            />
          </Form.Item>
          <Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              loading={accountLoading}
              block
            >
              {t("account.save")}
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Sider>
  );
}