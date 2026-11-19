import { describe, expect, it } from "vitest";
import { LuauAnalyzer } from "../../src/validation/LuauAnalyzer.js";

describe("LuauAnalyzer", () => {
  it("reports unbalanced block structure", () => {
    const issues = new LuauAnalyzer().validate("local function broken()");
    expect(issues.some((issue) => issue.code === "POSSIBLE_SYNTAX" || issue.code === "BLOCKS")).toBe(true);
  });

  it("flags monetization review points", () => {
    const source = "local MarketplaceService = game:GetService(\"MarketplaceService\")";
    const issues = new LuauAnalyzer().analyze(source);
    expect(issues.some((issue) => issue.code === "MONETIZATION")).toBe(true);
  });
});
