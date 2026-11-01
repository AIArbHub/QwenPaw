import type { AgentBackend, AgentSummary } from "../api/types/agents";
import type { HarnessCapabilities } from "../api/modules/harness";

export function requiresAIARBModel(backend: AgentBackend): boolean {
  return backend === "aiarb";
}

export function supportsPortabilityImport(agent?: AgentSummary): boolean {
  return (
    agent?.backend === "qwenpaw" &&
    agent.backend_capabilities?.workspace_ui !== false
  );
}

export function supportsAgentAttachments(
  backend: AgentBackend,
  capabilities?: Partial<HarnessCapabilities>,
): boolean {
  return requiresAIARBModel(backend) || Boolean(capabilities?.attachments);
}
