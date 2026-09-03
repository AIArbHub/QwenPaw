import type { MenuItem } from "../../plugins/registry/types";

interface AgentMenuCapabilities {
  workspace_ui?: boolean;
  native_skills_ui?: boolean;
  native_tools_ui?: boolean;
  native_mcp_ui?: boolean;
  aiarb_skills_projection?: boolean;
  aiarb_mcp_projection?: boolean;
  provider_skills_discovery?: boolean;
  provider_mcp_discovery?: boolean;
}

type MenuTreeItem = MenuItem & { __children?: MenuItem[] };

const NATIVE_WORKSPACE_MENU_IDS = new Set([
  "core.workspace",
  "core.agent-files-group",
  "core.agent-files-overview",
  "core.agent-files-workspace",
  "core.agent-files-persona",
  "core.agent-files-diary",
  "core.agent-files-kb",
  "core.acp",
  "core.agent-config",
  "core.agent-stats",
  "core.memory",
]);

export function filterMenuForAgentCapabilities(
  items: MenuItem[],
  capabilities: AgentMenuCapabilities | undefined,
): MenuItem[] {
  if (capabilities?.workspace_ui !== false) return items;
  const showSkills = Boolean(
    capabilities.native_skills_ui ||
      capabilities.aiarb_skills_projection ||
      capabilities.provider_skills_discovery,
  );
  const showTools = Boolean(capabilities.native_tools_ui);
  const showMcp = Boolean(
    capabilities.native_mcp_ui ||
      capabilities.aiarb_mcp_projection ||
      capabilities.provider_mcp_discovery,
  );
  const showAgentGroup = showSkills || showTools || showMcp;

  return items.flatMap((item) => {
    if (NATIVE_WORKSPACE_MENU_IDS.has(item.id)) return [];
    if (item.id === "core.agent-group" && !showAgentGroup) return [];
    if (item.id === "core.skills" && !showSkills) return [];
    if (item.id === "core.tools" && !showTools) return [];
    if (item.id === "core.mcp" && !showMcp) return [];

    const treeItem = item as MenuTreeItem;
    if (!treeItem.__children) return [item];
    return [
      {
        ...treeItem,
        __children: filterMenuForAgentCapabilities(
          treeItem.__children,
          capabilities,
        ),
      },
    ];
  });
}
