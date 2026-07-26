/**
 * builtinRoutes.ts — host's built-in routes as data.
 *
 * Importing self-registers all builtins into routeRegistry. MainLayout's
 * `useRoutes()` snapshot returns them. Plugin routes are registered via
 * `AIArb.route.add(...)` into the same registry and treated uniformly.
 *
 * Lazy components use `lazyImportWithRetry` inline; eager pages (Chat,
 * CodingPage) are passed as ComponentType directly. The `/` redirect is a
 * named route with a tiny DefaultRedirect component so routeRegistry has a
 * single uniform shape.
 *
 * Naming convention mirrors builtinMenu: `core.<key>`.
 */
import { Suspense } from "react";
import { Navigate } from "react-router-dom";
import { Spin } from "antd";
import { useTranslation } from "react-i18next";
import { lazyImportWithRetry, lazyWithRetry } from "../../utils/lazyWithRetry";
import { useCodingMode } from "../../stores/codingModeStore";
import { routeRegistry } from "../../plugins/registry/store";
import type { Route } from "../../plugins/registry/types";

// Eager pages
import Chat from "../../pages/Chat";
import CodingPage from "../../pages/Coding";

// Lazy pages
const ChannelsPage = lazyImportWithRetry("../../pages/Control/Channels");
const SessionsPage = lazyImportWithRetry("../../pages/Control/Sessions");
const InboxPage = lazyImportWithRetry("../../pages/Inbox");
const CronJobsPage = lazyImportWithRetry("../../pages/Control/CronJobs");
const HeartbeatPage = lazyImportWithRetry("../../pages/Control/Heartbeat");
const AgentConfigPage = lazyImportWithRetry("../../pages/Agent/Config");
// Unified skills page (tabs: skills / skill-pool / market) — reused across all sidebar modes
const UnifiedSkillsPage = lazyImportWithRetry("../../pages/Design/Skills");
const PetPage = lazyWithRetry(
  () => import("../../pages/Settings/Pet"),
  "../../pages/Settings/Pet",
);
const TextSelectionPage = lazyWithRetry(
  () => import("../../pages/Settings/TextSelection"),
  "../../pages/Settings/TextSelection",
);
const ToolsPage = lazyImportWithRetry("../../pages/Agent/Tools");
const WorkspacePage = lazyImportWithRetry("../../pages/Agent/Workspace");
const MCPPage = lazyImportWithRetry("../../pages/Agent/MCP");
const ACPPage = lazyImportWithRetry("../../pages/Agent/ACP");
const ModelsPage = lazyImportWithRetry("../../pages/Settings/Models");
const EnvironmentsPage = lazyImportWithRetry(
  "../../pages/Settings/Environments",
);
const SecurityPage = lazyImportWithRetry("../../pages/Settings/Security");
const TokenUsagePage = lazyImportWithRetry("../../pages/Settings/TokenUsage");
const AgentStatsPage = lazyImportWithRetry("../../pages/Settings/AgentStats");
const VoiceTranscriptionPage = lazyImportWithRetry(
  "../../pages/Settings/VoiceTranscription",
);
const AgentsPage = lazyImportWithRetry("../../pages/Settings/Agents");
const WorkbenchPage = lazyImportWithRetry("../../pages/Workbench");
const DebugPage = lazyImportWithRetry("../../pages/Settings/Debug");
const BackupsPage = lazyImportWithRetry("../../pages/Settings/Backups");
const CloudBackupsPage = lazyWithRetry(
  () => import("../../pages/Settings/CloudBackups"),
  "../../pages/Settings/CloudBackups",
);
const PluginManagerPage = lazyImportWithRetry(
  "../../pages/Settings/PluginManager",
);
const AppCenterPage = lazyImportWithRetry("../../pages/AppCenter");
const MemoryPage = lazyImportWithRetry("../../pages/Memory");
const KnowledgeBasePage = lazyImportWithRetry("../../pages/KnowledgeBase");
const FeedbackPage = lazyImportWithRetry("../../pages/Feedback");
const GrowthTimelinePage = lazyImportWithRetry("../../pages/GrowthTimeline");
const GlobalSearchPage = lazyImportWithRetry("../../pages/GlobalSearch");
const SopPage = lazyWithRetry(
  () => import("../../pages/Settings/Sop"),
  "../../pages/Settings/Sop",
);

/**
 * "/" lands here. Waits for useSyncCodingMode to populate the store before
 * deciding between /coding and /chat — see MainLayout.tsx history for why.
 */
function DefaultRedirect() {
  const { t } = useTranslation();
  const { codingMode, initialized } = useCodingMode();
  if (!initialized) {
    return (
      <Spin
        tip={t("common.loading")}
        style={{ display: "block", margin: "20vh auto" }}
      >
        <div />
      </Spin>
    );
  }
  return <Navigate to={codingMode ? "/coding" : "/chat"} replace />;
}

/** Synonym for /acp. Kept for plugins / external links that reference uppercase. */
function ACPRedirect() {
  return <Navigate to="/acp" replace />;
}

export const BUILTIN_ROUTES: Route[] = [
  { id: "core.root", path: "/", component: DefaultRedirect },
  { id: "core.chat", path: "/chat/*", component: Chat },
  { id: "core.coding", path: "/coding/*", component: CodingPage },
  { id: "core.channels", path: "/channels", component: ChannelsPage },
  { id: "core.sessions", path: "/sessions", component: SessionsPage },
  { id: "core.inbox", path: "/inbox", component: InboxPage },
  {
    id: "core.memory",
    path: "/memory",
    component: MemoryPage,
  },
  { id: "core.knowledge-base", path: "/kb", component: KnowledgeBasePage },
  { id: "core.feedback", path: "/feedback", component: FeedbackPage },
  { id: "core.growth", path: "/growth", component: GrowthTimelinePage },
  { id: "core.search", path: "/search", component: GlobalSearchPage },
  { id: "core.sop", path: "/sop", component: SopPage },
  { id: "core.cron-jobs", path: "/cron-jobs", component: CronJobsPage },
  { id: "core.heartbeat", path: "/heartbeat", component: HeartbeatPage },
  // ── Skills: unified tabbed page (技能 / 技能池 / 技能市场) for all sidebar modes ──
  { id: "core.skills", path: "/skills", component: UnifiedSkillsPage },
  // Keep old route as redirect to /skills?tab=pool for backward compat
  {
    id: "core.skill-pool",
    path: "/skill-pool",
    component: () => <Navigate to="/skills?tab=pool" replace />,
  },
  { id: "core.pet", path: "/pet", component: PetPage },
  {
    id: "core.text-selection",
    path: "/text-selection",
    component: TextSelectionPage,
  },
  { id: "core.tools", path: "/tools", component: ToolsPage },
  { id: "core.mcp", path: "/mcp", component: MCPPage },
  { id: "core.acp", path: "/acp", component: ACPPage },
  { id: "core.acp-alias", path: "/ACP", component: ACPRedirect },
  { id: "core.workspace", path: "/workspace", component: WorkspacePage },
  { id: "core.agents", path: "/agents", component: AgentsPage },
  { id: "core.workbench", path: "/workbench", component: WorkbenchPage },
  { id: "core.models", path: "/models", component: ModelsPage },
  {
    id: "core.environments",
    path: "/environments",
    component: EnvironmentsPage,
  },
  {
    id: "core.agent-config",
    path: "/agent-config",
    component: AgentConfigPage,
  },
  { id: "core.security", path: "/security", component: SecurityPage },
  { id: "core.token-usage", path: "/token-usage", component: TokenUsagePage },
  { id: "core.agent-stats", path: "/agent-stats", component: AgentStatsPage },
  {
    id: "core.voice-transcription",
    path: "/voice-transcription",
    component: VoiceTranscriptionPage,
  },
  { id: "core.debug", path: "/debug", component: DebugPage },
  { id: "core.backups", path: "/backups", component: BackupsPage },
  {
    id: "core.cloud-backups",
    path: "/cloud-backups",
    component: CloudBackupsPage,
  },
  {
    id: "core.plugin-manager",
    path: "/plugin-manager",
    component: PluginManagerPage,
  },
  { id: "core.app-center", path: "/apps", component: AppCenterPage },
  // Deep-link / refresh target: `/apps/<id>` also lands on the App Center,
  // which opens the app inline (with the “← App Center” bar) from the URL.
  {
    id: "core.app-center.embed",
    path: "/apps/:appId",
    component: AppCenterPage,
  },
];

routeRegistry.addBuiltin(BUILTIN_ROUTES);

// Suspense imported above is used by lazyImportWithRetry consumers; ref keeps
// TS from tree-shaking the import in older bundler configs.
void Suspense;