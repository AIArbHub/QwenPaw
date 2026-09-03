/**
 * MenuBar.tsx — macOS-style top menu bar.
 *
 * Left: brand mark + current Space (agent) name + the focused app's title.
 * Right: Mission Control, status glyphs, and a clock. The Space name and the
 * Mission Control button both open the Spaces switcher.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dropdown, Tooltip, type MenuProps } from "antd";
import {
  LayoutPanelTop,
  Bell,
  Wifi,
  Volume2,
  BatteryFull,
  ArrowLeft,
  Monitor,
  Cog,
  MessageSquareText,
} from "lucide-react";
import {
  SparkFullscreenLine,
  SparkExitFullscreenLine,
} from "@agentscope-ai/icons";
import { useAgentStore } from "../stores/agentStore";
import { useShallow } from "zustand/react/shallow";
import { useOsWindows } from "./osWindowStore";
import { useOsNotify } from "./osNotifyStore";
import { resolveAppDef } from "./osAppRegistry";
import { useOsStyles } from "./useOsStyles";
import { getConsoleRootHref } from "../utils/navigationMode";
import { useSidebarModeStore, type SidebarMode } from "../stores/sidebarModeStore";
import { LANGUAGE_LIST } from "../components/LanguageSwitcher";
import { languageApi } from "../api/modules/language";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function MenuBar({ hidden = false }: { hidden?: boolean }) {
  const { styles, cx } = useOsStyles();
  const { t, i18n } = useTranslation();
  const { agents } = useAgentStore();
  const sidebarMode = useSidebarModeStore((s) => s.mode);
  const setSidebarMode = useSidebarModeStore((s) => s.setMode);
  // Narrow subscription: geometry updates never re-render the menu bar.
  const { spaceId, activeId, missionControlOpen, setMissionControl } =
    useOsWindows(
      useShallow((s) => ({
        spaceId: s.spaceId,
        activeId: s.activeId,
        missionControlOpen: s.missionControlOpen,
        setMissionControl: s.setMissionControl,
      })),
    );
  const { approvalCount, inboxCount, centerOpen, setCenter } = useOsNotify();
  const unread = approvalCount + inboxCount;
  const notificationLabel = t("os.notificationSummary", {
    approvals: approvalCount,
    inbox: inboxCount,
    defaultValue: `Approvals ${approvalCount} · Inbox ${inboxCount}`,
  });
  const now = useClock();

  const spaceName = agents.find((a) => a.id === spaceId)?.name ?? spaceId;
  const activeApp = activeId ? resolveAppDef(activeId) : undefined;
  const activeTitle = activeApp
    ? t(activeApp.labelKey, activeApp.fallback)
    : t("os.finder", "Desktop");

  const time = now.toLocaleTimeString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  const KNOWN_LANG_KEYS = new Set(LANGUAGE_LIST.map((l) => l.key));
  const resolvedLanguage = i18n.resolvedLanguage || i18n.language;
  const currentLangKey = KNOWN_LANG_KEYS.has(resolvedLanguage)
    ? resolvedLanguage
    : resolvedLanguage.split("-")[0];

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
    languageApi
      .updateLanguage(lang)
      .catch((err) =>
        console.error("Failed to save language preference:", err),
      );
  };

  const settingsItems: MenuProps["items"] = [
    {
      type: "group",
      label: t("sidebar.settings.mode", "Mode"),
      children: [
        {
          key: "mode-full",
          icon: <SparkFullscreenLine />,
          label: t("sidebar.fullMode", "Full Mode"),
        },
        {
          key: "mode-simple",
          icon: <SparkExitFullscreenLine />,
          label: t("sidebar.simpleMode", "Simple Mode"),
        },
        {
          key: "mode-design",
          icon: <MessageSquareText size={14} />,
          label: t("sidebar.designMode", "Design Mode"),
        },
      ],
    },
    { type: "divider" },
    {
      type: "group",
      label: t("sidebar.settings.language", "Language"),
      children: LANGUAGE_LIST.map(({ key, label, icon }) => ({
        key: `lang-${key}`,
        label: label as string,
        icon,
      })),
    },
  ];

  const onSettingsClick: MenuProps["onClick"] = ({ key }) => {
    if (key.startsWith("mode-")) {
      const mode = key.replace("mode-", "") as SidebarMode;
      setSidebarMode(mode);
      window.location.assign(getConsoleRootHref(window.location.pathname));
      return;
    }
    if (key.startsWith("lang-")) {
      changeLanguage(key.replace("lang-", ""));
    }
  };

  return (
    <div
      className={cx(
        styles.menubar,
        hidden ? styles.menubarHidden : styles.menubarShown,
      )}
    >
      <div className={styles.menubarLeft}>
        <Dropdown
          placement="bottomLeft"
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "desktop",
                disabled: true,
                icon: <Monitor size={14} />,
                label: t("os.desktopMode", "Desktop mode"),
              },
              { type: "divider" },
              {
                key: "console",
                icon: <ArrowLeft size={14} />,
                label: t("os.returnToConsole", "Return to console"),
                onClick: () =>
                  window.location.assign(
                    getConsoleRootHref(window.location.pathname),
                  ),
              },
            ],
          }}
        >
          <button
            type="button"
            className={styles.menubarBrand}
            title={t("os.aiarbMenu", "AIArb menu")}
            aria-label={t("os.aiarbMenu", "AIArb menu")}
          >
            <img src="/aiarb.png" alt="AIArb" />
          </button>
        </Dropdown>
        <Tooltip
          title={t("os.currentSpaceLabel", {
            name: spaceName,
            defaultValue: `Current space: ${spaceName}`,
          })}
        >
          <span
            className={styles.menubarName}
            role="button"
            tabIndex={0}
            aria-label={t("os.currentSpace", "Current space")}
            onClick={() => setMissionControl(!missionControlOpen)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setMissionControl(!missionControlOpen);
              }
            }}
          >
            {spaceName}
          </span>
        </Tooltip>
        <Tooltip
          title={t("os.currentAppLabel", {
            name: activeTitle,
            defaultValue: `Current app: ${activeTitle}`,
          })}
        >
          <span className={styles.menubarItem} style={{ fontWeight: 600 }}>
            {activeTitle}
          </span>
        </Tooltip>
      </div>

      <div className={styles.menubarRight}>
        <Dropdown
          placement="bottomRight"
          trigger={["click"]}
          menu={{
            items: settingsItems,
            selectedKeys: [`mode-${sidebarMode}`, `lang-${currentLangKey}`],
            onClick: onSettingsClick,
          }}
        >
          <button
            type="button"
            className={styles.menubarBtn}
            title={t("os.settings", "Settings")}
            aria-label={t("os.settings", "Settings")}
          >
            <Cog size={14} />
          </button>
        </Dropdown>
        <Tooltip title={notificationLabel}>
          <button
            type="button"
            className={styles.notificationMenuButton}
            aria-label={`${t(
              "os.notifications",
              "Notifications",
            )}: ${notificationLabel}`}
            onClick={() => setCenter(!centerOpen)}
          >
            <Bell size={15} />
            {unread > 0 && (
              <span className={styles.notificationMenuCount} aria-hidden>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
        </Tooltip>
        <button
          className={styles.menubarBtn}
          title={t("os.missionControl", "Mission Control")}
          aria-label={t("os.missionControl", "Mission Control")}
          onClick={() => setMissionControl(!missionControlOpen)}
        >
          <LayoutPanelTop size={15} />
        </button>
        <BatteryFull size={16} />
        <Wifi size={14} />
        <Volume2 size={14} />
        <span>{time}</span>
      </div>
    </div>
  );
}
