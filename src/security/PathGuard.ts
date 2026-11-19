import path from "node:path";
import fs from "node:fs/promises";

export class PathGuard {
  constructor(private readonly root: string) {}

  resolve(relativePath: string): string {
    if (typeof relativePath !== "string" || relativePath.length === 0) {
      throw new Error("A non-empty relative path is required");
    }
    const root = path.resolve(this.root);
    const resolved = path.resolve(root, relativePath);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new Error("Path escapes the configured project directory");
    }
    return resolved;
  }

  async ensureInside(relativePath: string): Promise<string> {
    const resolved = this.resolve(relativePath);
    try {
      await fs.stat(resolved);
      return resolved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolved;
      throw error;
    }
  }
}
