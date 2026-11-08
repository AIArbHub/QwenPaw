/**
 * builtinMenu.ts — host's built-in sidebar menu entries as data.
 *
 * Importing this module self-registers all builtins into menuRegistry, so the
 * Sidebar's `useMenuItems()` snapshot returns them on first render. Plugins
 * register via `AIArb.menu.add(...)` which lands in the same registry, so
 * Sidebar treats core + plugin items uniformly.
 *
 * ── Naming convention ──────────────────────────────────────────────────────
 *  Group ids: `core.<name>-group` (e.g. core.control-group)
 *  Item ids:  `core.<key>`        (e.g. core.workspace)
 *  Plugin items use their own prefix (e.g. cloudpaw.a2a) — no clash possible.
 *
 * ── Sticky chat button carve-out ───────────────────────────────────────────
 *  `core.chat` is NOT in this data. The sticky chat button lives outside the
 *  antd <Menu> (rendered next to AgentSelector with bespoke styling); see
 *  Sidebar.tsx. We don't model it as menu data because it has zero antd-Menu
 *  semantics in common with the rest of the sidebar entries.
 *
 * ── Order convention ───────────────────────────────────────────────────────
 *  Within each group, items use order = 10/20/30/… in their natural sequence
 *  so plugins can insert with order 15/25 without colliding.
 */
import {
  Bot as SparkAgentLine,
  ChartNoAxesCombined as SparkBarChartLine,
  Database as SparkDataLine,
  CalendarDays as SparkDateLine,
  Bug as SparkDebugLine,
  Download as SparkDownloadLine,
  Mail as SparkEmailLine,
  Folder as SparkFile2Line,
  History as SparkHistoryLine,
  Globe as SparkInternetLine,
  WandSparkles as SparkMagicWandLine,
  Plug as SparkMcpMcpLine,
  Mic as SparkMicLine,
  Boxes as SparkModePlazaLine,
  Cog as RuntimeEngine,
  LayoutGrid as SparkMyApplicationLine,
  Save as SparkSaveLine,
  Scan as SparkScanLine,
  ShieldCheck as SparkSecurityLine,
  Sparkles as SparkSkillPoolLine,
  Wrench as SparkToolLine,
  MessagesSquare as SparkSessionsLine,
  AudioLines as SparkVoiceChat01Line,
  Wifi as SparkWifiLine,
  Brain,
  BookOpen,
  NotebookPen,
  FileSearch,
  Files,
} from "lucide-react";
import i18next from "../../i18n";
import { menuRegistry } from "../../plugins/registry/store";
import type { MenuItem } from "../../plugins/registry/types";

/** Translate a nav key. Falls back to defaultValue when i18n hasn't loaded. */
const navLabel = (key: string, defaultValue?: string) => (): string =>
  i18next.t(key, defaultValue ?? key);

export const BUILTIN_MENU: MenuItem[] = [
  // ── Agent-scoped (Sidebar Menu #1) ───────────────────────────────────────
  {
    id: "core.inbox",
    location: "primary.agentScoped",
    label: navLabel("nav.inbox"),
    icon: SparkEmailLine,
    route: "core.inbox",
    order: 10,
  },

  {
    id: "core.marketplace",
    location: "primary.agentScoped",
    label: navLabel("nav.marketplace", "Extension"),
    icon: SparkMyApplicationLine,
    route: "core.marketplace",
    order: 15,
  },
  {
    id: "core.import",
    location: "primary.agentScoped",
    label: navLabel("nav.import", "Import"),
    icon: SparkDownloadLine,
    route: "core.import",
    order: 17,
  },

  // ── Agent Files (一级菜单, 排在最前) ──────────────────────────────────────
  {
    id: "core.agent-files-group",
    location: "primary.agentScoped",
    label: navLabel("nav.agentFiles", "智能体文件"),
    isGroup: true,
    order: 5,
  },
  {
    id: "core.agent-files-overview",
    location: "primary.agentScoped",
    parentId: "core.agent-files-group",
    label: navLabel("nav.agentFilesOverview", "总览"),
    icon: Files,
    route: "core.files",
    order: 5,
  },
  {
    id: "core.agent-files-workspace",
    location: "primary.agentScoped",
    parentId: "core.agent-files-group",
    label: navLabel("nav.agentFilesWorkspace", "工作区文件"),
    icon: Files,
    route: "core.agent-files-workspace",
    order: 10,
  },
  {
    id: "core.agent-files-persona",
    location: "primary.agentScoped",
    parentId: "core.agent-files-group",
    label: navLabel("nav.agentFilesPersona", "灵魂人设"),
    icon: SparkSkillPoolLine,
    route: "core.agent-files-persona",
    order: 20,
  },
  {
    id: "core.agent-files-diary",
    location: "primary.agentScoped",
    parentId: "core.agent-files-group",
    label: navLabel("nav.agentFilesDiary", "日记"),
    icon: NotebookPen,
    route: "core.agent-files-diary",
    order: 30,
  },
  {
    id: "core.agent-files-kb",
    location: "primary.agentScoped",
    parentId: "core.agent-files-group",
    label: navLabel("nav.agentFilesSpecificKB", "专属知识库"),
    icon: BookOpen,
    route: "core.agent-files-kb",
    order: 40,
  },

  // ── Memory Center (一级菜单) ─────────────────────────────────────────────
  {
    id: "core.memory",
    location: "primary.agentScoped",
    label: navLabel("nav.memory", "记忆中心"),
    icon: Brain,
    route: "core.memory",
    order: 15,
  },

  // ── Knowledge Base (一级菜单) ────────────────────────────────────────────
  {
    id: "core.knowledge-base",
    location: "primary.agentScoped",
    label: navLabel("nav.knowledgeBase", "知识库"),
    icon: BookOpen,
    route: "core.knowledge-base",
    order: 16,
  },

  // ── Document Tools (一级菜单) ───────────────────────────────────────────
  {
    id: "core.document-tools",
    location: "primary.agentScoped",
    label: navLabel("nav.documentTools", "文档工具箱"),
    icon: FileSearch,
    route: "core.document-tools",
    order: 17,
  },

  // control-group
  {
    id: "core.control-group",
    location: "primary.agentScoped",
    label: navLabel("nav.control"),
    isGroup: true,
    order: 20,
  },
  {
    id: "core.channels",
    location: "primary.agentScoped",
    parentId: "core.control-group",
    label: navLabel("nav.channels"),
    icon: SparkWifiLine,
    route: "core.channels",
    order: 10,
  },
  {
    id: "core.sessions",
    location: "primary.agentScoped",
    parentId: "core.control-group",
    label: navLabel("nav.sessions"),
    icon: SparkSessionsLine,
    route: "core.sessions",
    order: 20,
  },
  {
    id: "core.cron-jobs",
    location: "primary.agentScoped",
    parentId: "core.control-group",
    label: navLabel("nav.cronJobs"),
    icon: SparkDateLine,
    route: "core.cron-jobs",
    order: 30,
  },
  {
    id: "core.heartbeat",
    location: "primary.agentScoped",
    parentId: "core.control-group",
    label: navLabel("nav.heartbeat"),
    icon: SparkVoiceChat01Line,
    route: "core.heartbeat",
    order: 40,
  },

  // workspace-group
  {
    id: "core.workspace-group",
    location: "primary.agentScoped",
    label: navLabel("nav.agent"),
    isGroup: true,
    order: 30,
  },
  {
    id: "core.files",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.files"),
    icon: SparkFile2Line,
    route: "core.files",
    order: 5,
  },
  {
    id: "core.skills",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.skills"),
    icon: SparkMagicWandLine,
    route: "core.skills",
    order: 10,
  },
  {
    id: "core.tools",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.tools"),
    icon: SparkToolLine,
    route: "core.tools",
    order: 20,
  },
  {
    id: "core.mcp",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.mcp"),
    icon: SparkMcpMcpLine,
    route: "core.mcp",
    order: 40,
  },
  {
    id: "core.acp",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.acp"),
    icon: SparkScanLine,
    route: "core.acp",
    order: 50,
  },
  {
    id: "core.agent-config",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.agentConfig"),
    icon: RuntimeEngine,
    route: "core.agent-config",
    order: 60,
  },
  {
    id: "core.agent-stats",
    location: "primary.agentScoped",
    parentId: "core.workspace-group",
    label: navLabel("nav.agentStats"),
    icon: SparkBarChartLine,
    route: "core.agent-stats",
    order: 70,
  },
  {
    id: "core.checkpoints",
    location: "primary.agentScoped",
    parentId: "core.agent-group",
    label: navLabel("checkpoints.nav"),
    icon: SparkHistoryLine,
    route: "core.checkpoints",
    order: 80,
  },

  // ── Settings (Sidebar Menu #2) ───────────────────────────────────────────
  {
    id: "core.settings-group",
    location: "primary.settings",
    label: navLabel("nav.settings"),
    isGroup: true,
    order: 10,
  },
  {
    id: "core.agents",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.agents"),
    icon: SparkAgentLine,
    route: "core.agents",
    order: 10,
  },
  {
    id: "core.models",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.models"),
    icon: SparkModePlazaLine,
    route: "core.models",
    order: 20,
  },
  {
    id: "core.skill-pool",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.skillPool", "Skill Pool"),
    icon: SparkSkillPoolLine,
    route: "core.skill-pool",
    order: 30,
  },
  {
    id: "core.environments",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.environments"),
    icon: SparkInternetLine,
    route: "core.environments",
    order: 50,
  },
  {
    id: "core.offload-policy",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.offloadPolicy", "Tool Offload"),
    icon: SparkDateLine,
    route: "core.offload-policy",
    order: 55,
  },
  {
    id: "core.security",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.security"),
    icon: SparkSecurityLine,
    route: "core.security",
    order: 60,
  },
  {
    id: "core.token-usage",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.tokenUsage"),
    icon: SparkDataLine,
    route: "core.token-usage",
    order: 70,
  },
  {
    id: "core.backups",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.backups"),
    icon: SparkSaveLine,
    route: "core.backups",
    order: 80,
  },
  {
    id: "core.voice-transcription",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.voiceTranscription"),
    icon: SparkMicLine,
    route: "core.voice-transcription",
    order: 90,
  },
  {
    id: "core.debug",
    location: "primary.settings",
    parentId: "core.settings-group",
    label: navLabel("nav.debug", "Debug"),
    icon: SparkDebugLine,
    route: "core.debug",
    order: 100,
  },
];

// Self-register at module load. main.tsx imports this file as a side-effect.
menuRegistry.addBuiltin(BUILTIN_MENU);
