import fs from "node:fs/promises";
import path from "node:path";
import { PathGuard } from "../../security/PathGuard.js";

export interface ProjectFile {
  path: string;
  type: "file" | "directory";
  size?: number;
  extension?: string;
}

export class ProjectFiles {
  readonly guard: PathGuard;

  constructor(private readonly root: string) {
    this.guard = new PathGuard(root);
  }

  async list(relativeDirectory = "", extension?: string): Promise<ProjectFile[]> {
    const absolute = await this.guard.ensureInside(relativeDirectory);
    const stat = await fs.stat(absolute).catch(() => undefined);
    if (!stat?.isDirectory()) throw new Error("Directory does not exist");

    const entries = await fs.readdir(absolute, { withFileTypes: true });
    const result: ProjectFile[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".luaurc") continue;
      if (!entry.isFile() && !entry.isDirectory()) continue;
      const absoluteEntry = path.join(absolute, entry.name);
      const relative = path.relative(this.root, absoluteEntry).replaceAll("\\", "/");
      const ext = entry.isFile() ? path.extname(entry.name).toLowerCase() : undefined;
      if (entry.isFile() && extension && ext !== extension.toLowerCase()) continue;
      const details = await fs.stat(absoluteEntry);
      result.push({
        path: relative,
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? details.size : undefined,
        extension: ext
      });
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }

  async readScript(relativePath: string): Promise<{ path: string; content: string }> {
    const absolute = await this.guard.ensureInside(relativePath);
    if (![".lua", ".luau"].includes(path.extname(absolute).toLowerCase())) {
      throw new Error("Only .lua and .luau script files are supported");
    }
    const content = await fs.readFile(absolute, "utf8");
    return { path: path.relative(this.root, absolute).replaceAll("\\", "/"), content };
  }

  async writeScript(relativePath: string, content: string, _scriptType: "Script" | "LocalScript" | "ModuleScript" = "ModuleScript"): Promise<{ path: string }> {
    const absolute = await this.guard.ensureInside(relativePath);
    if (![".lua", ".luau", ".server.lua", ".client.lua"].some((suffix) => relativePath.toLowerCase().endsWith(suffix))) {
      throw new Error("Script path must use a Luau/Lua extension");
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const before = await fs.readFile(absolute, "utf8").catch(() => undefined);
    if (before !== undefined) {
      await fs.writeFile(absolute, content, "utf8");
    } else {
      await fs.writeFile(absolute, content, { encoding: "utf8", flag: "wx" });
    }
    return { path: path.relative(this.root, absolute).replaceAll("\\", "/") };
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absolute = await this.guard.ensureInside(relativePath);
    await fs.unlink(absolute);
  }

  async getProjectInfo(): Promise<Record<string, unknown>> {
    const rootStat = await fs.stat(this.root).catch(() => undefined);
    if (!rootStat?.isDirectory()) throw new Error("Configured project directory does not exist");
    const rojoCandidates = ["default.project.json", "default.project.luau", "project.json"];
    const rojoFiles: string[] = [];
    for (const candidate of rojoCandidates) {
      if (await fs.stat(path.join(this.root, candidate)).then(() => true).catch(() => false)) rojoFiles.push(candidate);
    }
    const projectName = path.basename(this.root);
    return { projectName, root: this.root, rojoConfigured: rojoFiles.length > 0, rojoFiles };
  }

  async getStructure(relativeDirectory = "", depth = 4): Promise<Record<string, unknown>> {
    const absolute = await this.guard.ensureInside(relativeDirectory);
    const build = async (directory: string, currentDepth: number): Promise<Record<string, unknown>> => {
      const name = path.basename(directory);
      if (currentDepth <= 0) return { name, truncated: true };
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const children: Record<string, unknown>[] = [];
      for (const entry of entries) {
        if (entry.name.startsWith(".") && entry.name !== ".luaurc") continue;
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) children.push(await build(child, currentDepth - 1));
        else if ([".lua", ".luau", ".json"].includes(path.extname(entry.name).toLowerCase())) {
          children.push({ name: entry.name, type: "file" });
        }
      }
      return { name, type: "directory", children: children.sort((a, b) => String(a.name).localeCompare(String(b.name))) };
    };
    return build(absolute, depth);
  }
}
