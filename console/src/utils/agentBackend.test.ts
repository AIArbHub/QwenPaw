import { describe, expect, it } from "vitest";

import { requiresAIArbModel, supportsAgentAttachments } from "./agentBackend";

describe("requiresAIArbModel", () => {
  it("requires a configured model for native AIArb agents", () => {
    expect(requiresAIArbModel("aiarb")).toBe(true);
  });

  it("does not inspect AIArb models for Codex agents", () => {
    expect(requiresAIArbModel("codex")).toBe(false);
  });
});

describe("supportsAgentAttachments", () => {
  it("keeps attachments enabled for native agents", () => {
    expect(supportsAgentAttachments("aiarb")).toBe(true);
  });

  it("enables sender drop handling when Codex declares attachments", () => {
    expect(
      supportsAgentAttachments("codex", {
        attachments: true,
      }),
    ).toBe(true);
  });

  it("enables sender drop handling when Qoder declares attachments", () => {
    expect(
      supportsAgentAttachments("qoder", {
        attachments: true,
      }),
    ).toBe(true);
  });

  it("keeps attachments hidden for backends without the capability", () => {
    expect(supportsAgentAttachments("qoder", {})).toBe(false);
  });
});
