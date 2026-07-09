import { describe, expect, it } from "vitest";
import { buildAutoCaseSummary, buildCaseSearchText, createDefaultCollaborationPresets, getCaseGuidanceSteps, getCaseProgressSummary } from "./utils";

describe("moot utils", () => {
  it("builds searchable text from case data", () => {
    const text = buildCaseSearchText({
      case_name: "合同争议模拟案",
      case_description: "涉及跨境货物运输争议",
      rules: ["UNCITRAL 2010"],
      participants: [{ display_name: "申请人一" }],
    });

    expect(text).toContain("合同争议模拟案");
    expect(text).toContain("跨境货物运输争议");
    expect(text).toContain("uncitral");
    expect(text).toContain("申请人一");
  });

  it("builds an auto summary from uploaded files", () => {
    const summary = buildAutoCaseSummary(
      [
        { filename: "仲裁申请书.pdf", description: "主张损失赔偿", category: "pleading" },
        { filename: "证据清单.xlsx", description: "运输合同与发票", category: "evidence" },
      ],
      "默认案件背景",
    );

    expect(summary).toContain("仲裁申请书.pdf");
    expect(summary).toContain("运输合同与发票");
    expect(summary).toContain("默认案件背景");
  });

  it("creates default collaboration presets", () => {
    const presets = createDefaultCollaborationPresets();
    expect(presets.length).toBeGreaterThan(0);
    expect(presets[0]).toHaveProperty("id");
    expect(presets[0]).toHaveProperty("collaboration_mode");
  });

  it("creates guidance steps for an incomplete case", () => {
    const steps = getCaseGuidanceSteps({
      case_description: "",
      participants: [],
      rules: [],
      messages: [],
      current_stage: "draft",
      files: [],
    });

    expect(steps[0].done).toBe(false);
    expect(steps[0].title).toContain("补充案件背景");
    expect(steps.some((step) => step.title.includes("添加参与者"))).toBe(true);
  });

  it("summarizes case readiness progress", () => {
    const summary = getCaseProgressSummary([
      { key: "background", title: "补充案件背景", description: "", done: true },
      { key: "participants", title: "添加参与者", description: "", done: true },
      { key: "rules", title: "确认仲裁规则", description: "", done: false },
      { key: "materials", title: "上传材料与证据", description: "", done: false },
      { key: "dialogue", title: "开始实训对话", description: "", done: false },
    ]);

    expect(summary.completed).toBe(2);
    expect(summary.percent).toBe(40);
    expect(summary.label).toBe("正在搭建");
  });
});
