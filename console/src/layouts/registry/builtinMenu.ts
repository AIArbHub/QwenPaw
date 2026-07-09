/**
 * builtinMenu.ts — host's built-in sidebar menu entries as data.
 *
 * Importing this module self-registers all builtins into menuRegistry, so the
 * Sidebar's `useMenuItems()` snapshot returns them on first render. Plugins
 * register via `QwenPaw.menu.add(...)` which lands in the same registry, so
 * Sidebar treats core + plugin items uniformly.
 *
 * ── Design principles (2026-07) ────────────────────────────────────────────
 *  Task-oriented instead of feature-oriented:
 *  - 仲裁工作台 / 本地资料 / 模拟仲裁 / 文书工具 → primary.arbitration tab
 *  - 模型管理 / 智能体管理 → primary.agentScoped (agent tab top)
 *  - 高级设置 (15 技术项) → primary.settings (agent tab bottom, collapsed)
 *
 * ── Naming convention ──────────────────────────────────────────────────────
 *  Group ids: `core.<name>-group` (e.g. core.workspace-group)
 *  Item ids:  `core.<key>`        (e.g. core.workbench)
 *  Plugin items use their own prefix (e.g. cloudpaw.a2a) — no clash possible.
 *
 * ── Sticky chat button carve-out ───────────────────────────────────────────
 *  `core.chat` is NOT in this data. The sticky chat button lives outside the
 *  antd <Menu> (rendered next to AgentSelector with bespoke styling); see
 *  Sidebar.tsx. We don't model it as menu data because it has zero antd-Menu
 *  semantics in common with the rest of the sidebar entries.
 *
 * ── Removed from nav (routes preserved) ────────────────────────────────────
 *  core.inbox, core.cron-jobs, core.heartbeat, core.skill-pool, core.market,
 *  core.voice-transcription, core.agent-stats
 *
 * ── Order convention ───────────────────────────────────────────────────────
 *  Within each group, items use order = 10/20/30/… in their natural sequence
 *  so plugins can insert with order 15/25 without colliding.
 */
import {
  SparkAgentLine,
  SparkBrowseLine,
  SparkDataLine,
  SparkDebugLine,
  SparkInternetLine,
  SparkLocalFileLine,
  SparkMagicWandLine,
  SparkMcpMcpLine,
  SparkModifyLine,
  SparkMyApplicationLine,
  SparkOtherLine,
  SparkPluginLine,
  SparkModePlazaLine,
  SparkSaveLine,
  SparkScanLine,
  SparkToolLine,
  SparkUserGroupLine,
  SparkWifiLine,
} from "@agentscope-ai/icons";
import { Package, Users, FolderOpen, FileText, BookOpen, Briefcase } from "lucide-react";
import i18next from "i18next";
import { menuRegistry } from "../../plugins/registry/store";
import type { MenuItem } from "../../plugins/registry/types";

/** Translate a nav key. Falls back to defaultValue when i18n hasn't loaded. */
const navLabel = (key: string, defaultValue?: string) => (): string =>
  i18next.t(key, defaultValue ?? key);

export const BUILTIN_MENU: MenuItem[] = [
  // ── Arbitration tools (arbitration tab) ─────────────────────────────────
  {
    id: "core.inbox",
    location: "primary.agentScoped",
    label: navLabel("nav.inbox"),
    icon: SparkEmailLine,
    route: "core.inbox",
    order: 10,
  },

  {
    id: "core.app-center",
    location: "primary.agentScoped",
    label: navLabel("nav.apps", "Apps"),
    icon: SparkMyApplicationLine,
    route: "core.app-center",
    order: 15,
  },

  {
    id: "core.tools-group",
    location: "primary.arbitration",
    label: navLabel("nav.arbitration", "仲裁工具"),
    isGroup: true,
    order: 10,
  },
    isGroup: true,
    order: 10,
  },
  {
    id: "core.knowledge",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.knowledge", "本地资料"),
    icon: FolderOpen,
    route: "core.knowledge",
    order: 10,
  },
  {
    id: "core.moot",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.moot", "模拟仲裁"),
    icon: Users,
    route: "core.moot",
    order: 20,
  },
  {
    id: "core.desensitize",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.desensitize", "脱敏"),
    icon: FileText,
    route: "core.desensitize",
    order: 30,
  },
  {
    id: "core.wiki",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.wiki", "Wiki"),
    icon: BookOpen,
    route: "core.wiki",
    order: 40,
  },
  {
    id: "core.cases",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.cases", "案件卷宗"),
    icon: Briefcase,
    route: "core.cases",
    order: 50,
  },

  // ── Settings (agent tab, top section) ───────────────────────────────────
  {
    id: "core.settings-group",
    location: "primary.agentScoped",
    label: navLabel("nav.settings", "设置"),
    isGroup: true,
    order: 10,
  },
  {
    id: "core.models",
    location: "primary.agentScoped",
    parentId: "core.settings-group",
    label: navLabel("nav.models", "模型管理"),
    icon: SparkModePlazaLine,
    route: "core.models",
    order: 10,
  },
  {
    id: "core.agents",
    location: "primary.agentScoped",
    parentId: "core.settings-group",
    label: navLabel("nav.agents", "智能体管理"),
    icon: SparkAgentLine,
    route: "core.agents",
    order: 20,
  },

  // ── Advanced settings (agent tab, bottom section via primary.settings) ──
  {
    id: "core.advanced-group",
    location: "primary.settings",
    label: navLabel("nav.advanced", "高级设置"),
    isGroup: true,
    order: 10,
  },
  {
    id: "core.workspace",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.workspace", "工作区文件"),
    icon: SparkLocalFileLine,
    route: "core.workspace",
    order: 10,
  },
  {
    id: "core.skills",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.skills", "技能"),
    icon: SparkMagicWandLine,
    route: "core.skills",
    order: 20,
  },
  {
    id: "core.tools",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.toolsCaps", "工具"),
    icon: SparkToolLine,
    route: "core.tools",
    order: 30,
  },
  {
    id: "core.mcp",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.mcp", "MCP"),
    icon: SparkMcpMcpLine,
    route: "core.mcp",
    order: 40,
  },
  {
    id: "core.acp",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.acp", "ACP"),
    icon: SparkScanLine,
    route: "core.acp",
    order: 50,
  },
  {
    id: "core.agent-config",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.agentConfig", "Agent配置"),
    icon: SparkModifyLine,
    route: "core.agent-config",
    order: 60,
  },
  {
    id: "core.channels",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.channels", "渠道"),
    icon: SparkWifiLine,
    route: "core.channels",
    order: 70,
  },
  {
    id: "core.sessions",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.sessions", "会话"),
    icon: SparkUserGroupLine,
    route: "core.sessions",
    order: 80,
  },
  {
    id: "core.token-usage",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.tokenUsage", "Token 用量"),
    icon: SparkAgentLine,
    route: "core.agents",
    order: 90,
  },
  {
    id: "core.security",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.security", "安全"),
    icon: SparkBrowseLine,
    route: "core.security",
    order: 100,
  },
  {
    id: "core.backups",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.backups", "备份"),
    icon: SparkSaveLine,
    route: "core.backups",
    order: 110,
  },
  {
    id: "core.debug",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.debug", "调试"),
    icon: SparkDebugLine,
    route: "core.debug",
    order: 120,
  },
  {
    id: "core.plugin-manager",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.pluginManager", "Plugin Manager"),
    icon: Package,
    route: "core.plugin-manager",
    order: 130,
  },
  {
    id: "core.environments",
    location: "primary.settings",
    parentId: "core.advanced-group",
    label: navLabel("nav.environments", "环境变量"),
    icon: SparkInternetLine,
    route: "core.environments",
    order: 140,
  },
];

// Self-register at module load. main.tsx imports this file as a side-effect.
menuRegistry.addBuiltin(BUILTIN_MENU);