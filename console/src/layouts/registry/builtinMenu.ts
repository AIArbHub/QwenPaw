/**
 * builtinMenu.ts — host's built-in sidebar menu entries as data.
 *
 * Importing this module self-registers all builtins into menuRegistry, so the
 * Sidebar's `useMenuItems()` snapshot returns them on first render. Plugins
 * register via `AIArb.menu.add(...)` which lands in the same registry, so
 * Sidebar treats core + plugin items uniformly.
 *
 * ── Design principles (2026-07-24 redesign) ───────────────────────────────
 *  User-centric (C端) layering with 5 groups across 3 locations:
 *
 *  primary.agentWorkspace (顶部)
 *    ├── 快速入口 (2 items, no group) — inbox, app-center
 *    └── 智能体工作区 (6 items) — workspace, skills, tools, mcp, acp, agent-config
 *
 *  primary.settings (系统设置)
 *    ├── 系统设置 (12 items) — models, agents, channels, sessions, token-usage,
 *    │                        environments, memory, security, backups, cloud-backups,
 *    │                        plugin-manager, agent-stats
 *    ├── 用户偏好 (3 items) — pet, text-selection, voice-transcription
 *    └── 运维与调试 (3 items) — debug, cron-jobs, heartbeat
 *
 * ── Naming convention ──────────────────────────────────────────────────────
 *  Group ids: `core.<name>-group` (e.g. core.agent-workspace-group)
 *  Item ids:  `core.<key>`        (e.g. core.workspace)
 *  Plugin items use their own prefix (e.g. cloudpaw.a2a) — no clash possible.
 *
 * ── Sticky chat button carve-out ───────────────────────────────────────────
 *  `core.chat` is NOT in this data. The sticky chat button lives outside the
 *  antd <Menu> (rendered next to AgentSelector with bespoke styling); see
 *  Sidebar.tsx.
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
  SparkEmailLine,
  SparkInternetLine,
  SparkLocalFileLine,
  SparkMagicWandLine,
  SparkMcpMcpLine,
  SparkMicLine,
  SparkModifyLine,
  SparkMyApplicationLine,
  SparkModePlazaLine,
  SparkSaveLine,
  SparkScanLine,
  SparkToolLine,
  SparkUserGroupLine,
  SparkWifiLine,
} from "@agentscope-ai/icons";
import { Package, Brain, Clock, Activity, PawPrint, ScanText, Cloud, Workflow } from "lucide-react";
import i18next from "i18next";
import { menuRegistry } from "../../plugins/registry/store";
import type { MenuItem } from "../../plugins/registry/types";

/** Translate a nav key. Falls back to defaultValue when i18n hasn't loaded. */
const navLabel = (key: string, defaultValue?: string) => (): string =>
  i18next.t(key, defaultValue ?? key);

export const BUILTIN_MENU: MenuItem[] = [
  // ══ primary.agentWorkspace ════════════════════════════════════════════════

  // ── 快速入口 (top-level, no group) ──────────────────────────────────────
  {
    id: "core.inbox",
    location: "primary.agentWorkspace",
    label: navLabel("nav.inbox"),
    icon: SparkEmailLine,
    route: "core.inbox",
    order: 10,
  },
  {
    id: "core.app-center",
    location: "primary.agentWorkspace",
    label: navLabel("nav.apps", "Apps"),
    icon: SparkMyApplicationLine,
    route: "core.app-center",
    order: 15,
  },

  // ── 智能体工作区 ─────────────────────────────────────────────────────────
  {
    id: "core.agent-workspace-group",
    location: "primary.agentWorkspace",
    label: navLabel("nav.agentWorkspace", "智能体工作区"),
    isGroup: true,
    order: 20,
  },
  {
    id: "core.workspace",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.workspace", "工作区文件"),
    icon: SparkLocalFileLine,
    route: "core.workspace",
    order: 10,
  },
  {
    id: "core.skills",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.skills", "技能"),
    icon: SparkMagicWandLine,
    route: "core.skills",
    order: 20,
  },
  {
    id: "core.tools",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.tools", "工具"),
    icon: SparkToolLine,
    route: "core.tools",
    order: 30,
  },
  {
    id: "core.mcp",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.mcp", "MCP"),
    icon: SparkMcpMcpLine,
    route: "core.mcp",
    order: 40,
  },
  {
    id: "core.acp",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.acp", "ACP"),
    icon: SparkScanLine,
    route: "core.acp",
    order: 50,
  },
  {
    id: "core.agent-config",
    location: "primary.agentWorkspace",
    parentId: "core.agent-workspace-group",
    label: navLabel("nav.agentConfig", "Agent配置"),
    icon: SparkModifyLine,
    route: "core.agent-config",
    order: 60,
  },

  // ══ primary.settings ═══════════════════════════════════════════════════

  // ── 系统设置 ─────────────────────────────────────────────────────────────
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
    id: "core.environments",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.environments", "环境变量"),
    icon: SparkInternetLine,
    route: "core.environments",
    order: 60,
  },
  {
    id: "core.memory",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.memory", "记忆中心"),
    icon: Brain,
    route: "core.memory",
    order: 80,
  },
  {
    id: "core.sop",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.sop", "流程引擎"),
    icon: Workflow,
    route: "core.sop",
    order: 85,
  },
  {
    id: "core.security",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.security", "安全"),
    icon: SparkBrowseLine,
    route: "core.security",
    order: 90,
  },
  {
    id: "core.backups",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.backups", "备份"),
    icon: SparkSaveLine,
    route: "core.backups",
    order: 100,
  },
  {
    id: "core.cloud-backups",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.cloudBackups", "云备份"),
    icon: Cloud,
    route: "core.cloud-backups",
    order: 101,
  },
  {
    id: "core.plugin-manager",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.pluginManager", "插件"),
    icon: Package,
    route: "core.plugin-manager",
    order: 110,
  },
  {
    id: "core.agent-stats",
    location: "primary.settings",
    parentId: "core.system-settings-group",
    label: navLabel("nav.agentStats", "智能体统计"),
    icon: SparkDataLine,
    route: "core.agent-stats",
    order: 120,
  },

  // ── 用户偏好 ─────────────────────────────────────────────────────────────
  {
    id: "core.user-prefs-group",
    location: "primary.settings",
    label: navLabel("nav.userPrefs", "用户偏好"),
    isGroup: true,
    order: 20,
  },
  {
    id: "core.pet",
    location: "primary.settings",
    parentId: "core.user-prefs-group",
    label: navLabel("nav.pet", "桌面宠物"),
    icon: PawPrint,
    route: "core.pet",
    order: 10,
  },
  {
    id: "core.text-selection",
    location: "primary.settings",
    parentId: "core.user-prefs-group",
    label: navLabel("nav.textSelection", "全局划词"),
    icon: ScanText,
    route: "core.text-selection",
    order: 20,
  },
  {
    id: "core.voice-transcription",
    location: "primary.settings",
    parentId: "core.user-prefs-group",
    label: navLabel("nav.voiceTranscription", "语音转写"),
    icon: SparkMicLine,
    route: "core.voice-transcription",
    order: 30,
  },

  // ── 运维与调试 ───────────────────────────────────────────────────────────
  {
    id: "core.ops-debug-group",
    location: "primary.settings",
    label: navLabel("nav.opsDebug", "运维与调试"),
    isGroup: true,
    order: 30,
  },
  {
    id: "core.debug",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.debug", "调试"),
    icon: SparkDebugLine,
    route: "core.debug",
    order: 10,
  },
  {
    id: "core.cron-jobs",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.cronJobs", "定时任务"),
    icon: Clock,
    route: "core.cron-jobs",
    order: 20,
  },
  {
    id: "core.heartbeat",
    location: "primary.settings",
    parentId: "core.ops-debug-group",
    label: navLabel("nav.heartbeat", "心跳"),
    icon: Activity,
    route: "core.heartbeat",
    order: 30,
  },
];

// Self-register at module load. main.tsx imports this file as a side-effect.
menuRegistry.addBuiltin(BUILTIN_MENU);
