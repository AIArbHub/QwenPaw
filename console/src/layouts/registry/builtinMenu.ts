/**
 * builtinMenu.ts — host's built-in sidebar menu entries as data.
 *
 * Importing this module self-registers all builtins into menuRegistry, so the
 * Sidebar's `useMenuItems()` snapshot returns them on first render. Plugins
 * register via `QwenPaw.menu.add(...)` which lands in the same registry, so
 * Sidebar treats core + plugin items uniformly.
 *
 * ── Design principles (2026-07) ────────────────────────────────────────────
 *  User-centric (C端) layering with 4 groups across 3 locations:
 *  - 仲裁业务 (5 domain items) → primary.arbitration — always fully visible
 *  - 智能体工作区 (6 items)    → primary.agentScoped  — workspace-level config
 *  - 系统设置 (6 items)        → primary.settings grp1 — global system config
 *  - 运维与调试 (9 items)      → primary.settings grp2 — ops/debug, collapsible
 *
 * ── Naming convention ──────────────────────────────────────────────────────
 *  Group ids: `core.<name>-group` (e.g. core.tools-group)
 *  Item ids:  `core.<key>`        (e.g. core.knowledge)
 *  Plugin items use their own prefix (e.g. cloudpaw.a2a) — no clash possible.
 *
 * ── Sticky chat button carve-out ───────────────────────────────────────────
 *  `core.chat` is NOT in this data. The sticky chat button lives outside the
 *  antd <Menu> (rendered next to AgentSelector with bespoke styling); see
 *  Sidebar.tsx. We don't model it as menu data because it has zero antd-Menu
 *  semantics in common with the rest of the sidebar entries.
 *
 * ── Removed from sidebar nav (routes preserved) ────────────────────────────
 *  core.inbox — accessed via header icon button with unread badge
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
  SparkMicLine,
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
import { Package, Users, FolderOpen, FileText, BookOpen, Briefcase, Brain, Clock, Activity, Layers, PawPrint, ScanText, Cloud, ScrollText, Scale, Settings, Gavel, FolderKanban, Cpu } from "lucide-react";
import i18next from "i18next";
import { menuRegistry } from "../../plugins/registry/store";
import type { MenuItem } from "../../plugins/registry/types";

/** Translate a nav key. Falls back to defaultValue when i18n hasn't loaded. */
const navLabel = (key: string, defaultValue?: string) => (): string =>
  i18next.t(key, defaultValue ?? key);

export const BUILTIN_MENU: MenuItem[] = [
  // ── 仲裁业务 (primary.arbitration) ──────────────────────────────────────
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
    label: navLabel("nav.arbitration", "仲裁业务"),
    isGroup: true,
    order: 10,
  },
    isGroup: true,
    order: 10,
  },
  {
    id: "core.desk",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.desk", "仲裁工作台"),
    icon: Scale,
    route: "core.desk",
    order: 10,
  },
  {
    id: "core.knowledge",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.knowledgeDesk", "知识工作台"),
    icon: BookOpen,
    route: "core.knowledge-desk",
    order: 20,
  },
  {
    id: "core.engine-settings",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.engineSettings", "文档引擎设置"),
    icon: Cpu,
    route: "core.engine-settings",
    order: 30,
  },
  {
    id: "core.moot",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.moot", "模拟仲裁"),
    icon: Gavel,
    route: "core.moot",
    order: 40,
  },
  {
    id: "core.cases",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.cases", "案件管理"),
    icon: FolderKanban,
    route: "core.cases",
    order: 50,
  },
  {
    id: "core.memory",
    location: "primary.arbitration",
    parentId: "core.tools-group",
    label: navLabel("nav.memory", "记忆中心"),
    icon: Brain,
    route: "core.memory",
    order: 60,
  },

  // ── 智能体工作区 (primary.agentScoped) ─────────────────────────────────
  {
    id: "core.agent-workspace-group",
    location: "primary.agentScoped",
    label: navLabel("nav.agentWorkspace", "智能体工作区"),
    isGroup: true,
    order: 10,
  },
  {
    id: "core.workspace",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.workspace", "工作区文件"),
    icon: SparkLocalFileLine,
    route: "core.workspace",
    order: 10,
  },
  {
    id: "core.skills",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.skills", "技能"),
    icon: SparkMagicWandLine,
    route: "core.skills",
    order: 20,
  },
  {
    id: "core.tools",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.tools", "工具"),
    icon: SparkToolLine,
    route: "core.tools",
    order: 30,
  },
  {
    id: "core.mcp",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.mcp", "MCP"),
    icon: SparkMcpMcpLine,
    route: "core.mcp",
    order: 40,
  },
  {
    id: "core.acp",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.acp", "ACP"),
    icon: SparkScanLine,
    route: "core.acp",
    order: 50,
  },
  {
    id: "core.agent-config",
    location: "primary.agentScoped",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.agentConfig", "Agent配置"),
    icon: SparkModifyLine,
    route: "core.agent-config",
    order: 60,
  },

  // ── 系统设置 (primary.settings, group 1) ───────────────────────────────
  {
    id: "core.system-settings-group",
    location: "primary.settings",
    label: navLabel("nav.systemSettings", "系统设置"),
    isGroup: true,
    order: 10,
  },
  {
    id: "core.models",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.models", "模型管理"),
    icon: SparkModePlazaLine,
    route: "core.models",
    order: 10,
  },
  {
    id: "core.agents",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.agents", "智能体管理"),
    icon: SparkAgentLine,
    route: "core.agents",
    order: 20,
  },
  {
    id: "core.channels",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.channels", "渠道"),
    icon: SparkWifiLine,
    route: "core.channels",
    order: 30,
  },
  {
    id: "core.sessions",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.sessions", "会话"),
    icon: SparkUserGroupLine,
    route: "core.sessions",
    order: 40,
  },
  {
    id: "core.token-usage",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.tokenUsage", "Token 用量"),
    icon: SparkDataLine,
    route: "core.token-usage",
    order: 50,
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
    parentId: "core.system-settings-group",
    label: navLabel("nav.environments", "环境变量"),
    icon: SparkInternetLine,
    route: "core.environments",
    order: 60,
  },

  // ── 运维与调试 (primary.settings, group 2) ─────────────────────────────
  {
    id: "core.ops-debug-group",
    location: "primary.settings",
    label: navLabel("nav.opsDebug", "运维与调试"),
    isGroup: true,
    order: 20,
  },
  {
    id: "core.security",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.security", "安全"),
    icon: SparkBrowseLine,
    route: "core.security",
    order: 10,
  },
  {
    id: "core.backups",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.backups", "备份"),
    icon: SparkSaveLine,
    route: "core.backups",
    order: 20,
  },
  {
    id: "core.cloud-backups",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.cloudBackups", "云备份"),
    icon: Cloud,
    route: "core.cloud-backups",
    order: 21,
  },
  {
    id: "core.debug",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.debug", "调试"),
    icon: SparkDebugLine,
    route: "core.debug",
    order: 30,
  },
  {
    id: "core.plugin-manager",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.pluginManager", "插件"),
    icon: Package,
    route: "core.plugin-manager",
    order: 40,
  },
  {
    id: "core.cron-jobs",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.cronJobs", "定时任务"),
    icon: Clock,
    route: "core.cron-jobs",
    order: 50,
  },
  {
    id: "core.heartbeat",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.heartbeat", "心跳"),
    icon: Activity,
    route: "core.heartbeat",
    order: 60,
  },
  {
    id: "core.voice-transcription",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.voiceTranscription", "语音转写"),
    icon: SparkMicLine,
    route: "core.voice-transcription",
    order: 70,
  },
  {
    id: "core.agent-stats",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.agentStats", "智能体统计"),
    icon: SparkDataLine,
    route: "core.agent-stats",
    order: 80,
  },
  // core.skill-pool removed from menu — now a tab inside /skills (unified page)
  {
    id: "core.pet",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.pet", "桌面宠物"),
    icon: PawPrint,
    route: "core.pet",
    order: 100,
  },
  {
    id: "core.text-selection",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.textSelection", "全局划词"),
    icon: ScanText,
    route: "core.text-selection",
    order: 110,
  },
];

// Self-register at module load. main.tsx imports this file as a side-effect.
menuRegistry.addBuiltin(BUILTIN_MENU);