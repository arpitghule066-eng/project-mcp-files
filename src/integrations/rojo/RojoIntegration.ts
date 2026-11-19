import fs from "node:fs/promises";
import path from "node:path";

export class RojoIntegration {
  constructor(private readonly root: string) {}

  async status(): Promise<{ configured: boolean; projectFile: string | null; status: string }> {
    const candidates = ["default.project.json", "project.json"];
    for (const candidate of candidates) {
      if (await fs.stat(path.join(this.root, candidate)).then(() => true).catch(() => false)) {
        return { configured: true, projectFile: candidate, status: "configured; live sync status requires the Studio plugin bridge" };
      }
    }
    return { configured: false, projectFile: null, status: "not configured" };
  }
}
