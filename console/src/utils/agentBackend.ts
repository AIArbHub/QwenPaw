import type { AgentBackend } from "../api/types/agents";
import type { HarnessCapabilities } from "../api/modules/harness";

export function requiresAIArbModel(backend: AgentBackend): boolean {
  return backend === "aiarb";
}

export function supportsAgentAttachments(
  backend: AgentBackend,
  capabilities?: Partial<HarnessCapabilities>,
): boolean {
  return requiresAIArbModel(backend) || Boolean(capabilities?.attachments);
}
