import { describe, it, expect } from "vitest";
import { providerIcon } from "./providerIcon";

const FALLBACK =
  "https://gw.alicdn.com/imgextra/i4/O1CN01IWnlOw1lebfpiFrIL_!!6000000004844-0-tps-100-100.jpg";

describe("providerIcon", () => {
  it("returns the openai CDN url for the openai provider", () => {
    expect(providerIcon("openai")).toBe(
      "https://gw.alicdn.com/imgextra/i3/O1CN01rQSexq1D7S4AYstKh_!!6000000000169-2-tps-400-400.png",
    );
  });

  it("returns the same url for kimi-cn and kimi-intl (alias grouping)", () => {
    const cn = providerIcon("kimi-cn");
    const intl = providerIcon("kimi-intl");
    expect(cn).toBe(intl);
    expect(cn).toBe(
      "https://gw.alicdn.com/imgextra/i1/O1CN01xCKAr81Yz8Q9pXh1u_!!6000000003129-2-tps-400-400.png",
    );
  });

  it("returns the fallback url for an unknown provider", () => {
    expect(providerIcon("unknown-provider")).toBe(FALLBACK);
    expect(providerIcon("")).toBe(FALLBACK);
  });

  it("returns the local bundled image for the embedded aiarb-local provider", () => {
    expect(providerIcon("aiarb-local")).toBe("/aiarb.png");
  });

  it("always returns a non-empty url for every supported provider", () => {
    // aiarb-local is the embedded local model and uses a bundled asset
    // (/aiarb.png) instead of a remote CDN url, so it is asserted separately.
    const known = [
      "modelscope",
      "aliyun-codingplan",
      "aliyun-codingplan-intl",
      "aliyun-tokenplan",
      "deepseek",
      "gemini",
      "azure-openai",
      "anthropic",
      "ollama",
      "minimax-cn",
      "minimax",
      "dashscope",
      "lmstudio",
      "siliconflow-cn",
      "siliconflow-intl",
      "zhipu-cn",
      "zhipu-intl",
      "zhipu-cn-codingplan",
      "zhipu-intl-codingplan",
      "openrouter",
      "opencode",
      "kilo",
      "github-models",
      "volcengine-cn",
      "volcengine-cn-codingplan",
      "volcengine-cn-agentplan",
      "mimo-tokenplan",
      "mimo",
    ];
    for (const p of known) {
      const url = providerIcon(p);
      expect(url.startsWith("https://")).toBe(true);
      expect(url.length).toBeGreaterThan(0);
      expect(url).not.toBe(FALLBACK);
    }
  });
});
