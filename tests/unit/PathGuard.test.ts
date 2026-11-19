import { describe, expect, it } from "vitest";
import path from "node:path";
import { PathGuard } from "../../src/security/PathGuard.js";

describe("PathGuard", () => {
  it("allows paths inside the project", () => {
    const guard = new PathGuard(path.resolve("workspace"));
    expect(guard.resolve("src/Main.server.lua")).toBe(path.resolve("workspace", "src/Main.server.lua"));
  });

  it("blocks path traversal", () => {
    const guard = new PathGuard(path.resolve("workspace"));
    expect(() => guard.resolve("../outside.lua")).toThrow("escapes");
  });
});
