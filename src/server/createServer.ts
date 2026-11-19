import fs from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";
import type { AppConfig } from "../config.js";
import { ProjectFiles } from "../integrations/filesystem/ProjectFiles.js";
import { RojoIntegration } from "../integrations/rojo/RojoIntegration.js";
import { StudioBridge } from "../integrations/studio-bridge/StudioBridge.js";
import { LuauAnalyzer } from "../validation/LuauAnalyzer.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

async function createBackup(root: string, backupRoot: string, label: string): Promise<string> {
  await fs.mkdir(backupRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(backupRoot, `${stamp}-${label}`);
  await fs.cp(root, destination, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}.git${path.sep}`) && !source.includes(`${path.sep}node_modules${path.sep}`) && !source.includes(`${path.sep}.backups${path.sep}`)
  });
  return destination;
}

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer({ name: "roblox-studio-mcp", version: "1.0.0" }, { maxToolInputElements: 500 });
  const files = new ProjectFiles(config.projectRoot);
  const rojo = new RojoIntegration(config.projectRoot);
  const bridge = new StudioBridge(config.bridgePort, config.bridgeToken);
  const analyzer = new LuauAnalyzer();

  void bridge.start();

  server.registerTool("roblox_get_project_info", {
    description: "Read project information and detect Rojo configuration",
    inputSchema: z.object({})
  }, async () => text(await files.getProjectInfo()));

  server.registerTool("roblox_list_project_files", {
    description: "List files under the configured project directory",
    inputSchema: z.object({ directory: z.string().optional(), extension: z.string().optional() })
  }, async ({ directory, extension }) => text(await files.list(directory, extension)));

  server.registerTool("roblox_read_script", {
    description: "Read a Lua or Luau script safely",
    inputSchema: z.object({ path: z.string().min(1).max(1000) })
  }, async ({ path: scriptPath }) => text(await files.readScript(scriptPath)));

  server.registerTool("roblox_search_scripts", {
    description: "Search project scripts by regular expression or text",
    inputSchema: z.object({ pattern: z.string().min(1).max(500), directory: z.string().optional() })
  }, async ({ pattern, directory }) => {
    const matches: Array<{ path: string; line: number; text: string }> = [];
    const entries = await files.list(directory ?? "", undefined);
    const scan = async (entry: { path: string; type: string }) => {
      if (entry.type === "directory") {
        for (const child of await files.list(entry.path)) await scan(child);
      } else if ([".lua", ".luau"].includes(path.extname(entry.path).toLowerCase())) {
        const script = await files.readScript(entry.path);
        script.content.split(/\r?\n/).forEach((line, index) => {
          if (line.toLowerCase().includes(pattern.toLowerCase())) matches.push({ path: script.path, line: index + 1, text: line.trim() });
        });
      }
    };
    for (const entry of entries) await scan(entry);
    return text(matches.slice(0, 1000));
  });

  server.registerTool("roblox_get_project_structure", {
    description: "Return a bounded project hierarchy",
    inputSchema: z.object({ directory: z.string().optional(), depth: z.number().int().min(1).max(8).optional() })
  }, async ({ directory, depth }) => text(await files.getStructure(directory, depth)));

  server.registerTool("roblox_create_script", {
    description: "Create a Lua or Luau script",
    inputSchema: z.object({
      path: z.string().min(1).max(1000),
      content: z.string().max(2_000_000),
      scriptType: z.enum(["Script", "LocalScript", "ModuleScript"]).default("ModuleScript")
    })
  }, async ({ path: scriptPath, content, scriptType }) => text(await files.writeScript(scriptPath, content, scriptType)));

  server.registerTool("roblox_edit_script", {
    description: "Replace exact text or apply a full controlled script update",
    inputSchema: z.object({
      path: z.string().min(1).max(1000),
      oldText: z.string().optional(),
      content: z.string().max(2_000_000),
      createBackup: z.boolean().default(true)
    })
  }, async ({ path: scriptPath, oldText, content, createBackup: shouldBackup }) => {
    const existing = await files.readScript(scriptPath);
    if (shouldBackup) await createBackup(config.projectRoot, config.backupRoot, "script-edit");
    const updated = oldText === undefined ? content : existing.content.replace(oldText, content);
    if (oldText !== undefined && updated === existing.content) throw new Error("Exact replacement text was not found");
    await files.writeScript(scriptPath, updated);
    return text({ path: existing.path, changed: true });
  });

  server.registerTool("roblox_delete_script", {
    description: "Delete a script after explicit confirmation and create a backup",
    inputSchema: z.object({ path: z.string().min(1).max(1000), confirm: z.literal(true) })
  }, async ({ path: scriptPath, confirm }) => {
    if (!confirm) throw new Error("Deletion requires confirm=true");
    await createBackup(config.projectRoot, config.backupRoot, "script-delete");
    await files.deleteFile(scriptPath);
    return text({ deleted: scriptPath, backupCreated: true });
  });

  server.registerTool("roblox_compare_script_versions", {
    description: "Compare a current script with a previous Luau/Lua text snapshot",
    inputSchema: z.object({ path: z.string().min(1).max(1000), previousContent: z.string().max(2_000_000) })
  }, async ({ path: scriptPath, previousContent }) => {
    const current = await files.readScript(scriptPath);
    const previousLines = previousContent.split(/\r?\n/);
    const currentLines = current.content.split(/\r?\n/);
    const changes: Array<{ line: number; previous: string | null; current: string | null }> = [];
    const lineCount = Math.max(previousLines.length, currentLines.length);
    for (let index = 0; index < lineCount; index++) {
      if (previousLines[index] !== currentLines[index]) changes.push({
        line: index + 1,
        previous: previousLines[index] ?? null,
        current: currentLines[index] ?? null
      });
    }
    return text({ path: current.path, changedLines: changes.length, changes: changes.slice(0, 5000) });
  });

  server.registerTool("roblox_validate_luau", {
    description: "Run local structural Luau checks",
    inputSchema: z.object({ path: z.string().min(1).max(1000).optional(), content: z.string().max(2_000_000).optional() })
  }, async ({ path: scriptPath, content }) => {
    if (scriptPath === undefined && content === undefined) throw new Error("Provide path or content");
    const source = content ?? (await files.readScript(scriptPath!)).content;
    return text(analyzer.validate(source));
  });

  server.registerTool("roblox_analyze_script", {
    description: "Analyze a script for common Luau security and performance risks",
    inputSchema: z.object({ path: z.string().min(1).max(1000).optional(), content: z.string().max(2_000_000).optional() })
  }, async ({ path: scriptPath, content }) => {
    if (scriptPath === undefined && content === undefined) throw new Error("Provide path or content");
    const source = content ?? (await files.readScript(scriptPath!)).content;
    return text(analyzer.analyze(source));
  });

  server.registerTool("roblox_run_validation", {
    description: "Run project-wide available validation checks",
    inputSchema: z.object({})
  }, async () => {
    const all = await files.list("");
    const results: unknown[] = [];
    for (const entry of all) {
      if (entry.type === "file" && [".lua", ".luau"].includes(path.extname(entry.path).toLowerCase())) {
        const script = await files.readScript(entry.path);
        results.push({ path: script.path, issues: [...analyzer.validate(script.content), ...analyzer.analyze(script.content)] });
      }
    }
    return text({ checks: "local Luau heuristics", results });
  });

  server.registerTool("roblox_get_sync_status", {
    description: "Check Rojo configuration and Studio bridge availability",
    inputSchema: z.object({})
  }, async () => text({ rojo: await rojo.status(), studio: bridge.status() }));

  for (const name of [
    "roblox_get_instance_tree", "roblox_get_instance_properties", "roblox_create_instance",
    "roblox_update_instance", "roblox_delete_instance", "roblox_find_instances",
    "roblox_get_selection", "roblox_get_output", "roblox_get_errors", "roblox_get_warnings",
    "roblox_get_test_status"
  ]) {
    server.registerTool(name, {
      description: `Studio live operation: ${name.replace("roblox_", "")}. Requires the Studio plugin bridge`,
      inputSchema: z.record(z.string(), z.unknown())
    }, async (args) => text(await bridge.request(name.replace("roblox_", ""), args as Record<string, unknown>, config.bridgeTimeoutMs)));
  }

  server.registerTool("roblox_create_backup", {
    description: "Create a timestamped project backup",
    inputSchema: z.object({ label: z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/).optional() })
  }, async ({ label }) => text({ backup: await createBackup(config.projectRoot, config.backupRoot, label ?? "manual") }));

  server.registerTool("roblox_import_asset", {
    description: "Record or inspect a supported local asset before Studio import",
    inputSchema: z.object({ path: z.string().min(1).max(1000) })
  }, async ({ path: assetPath }) => {
    const absolute = await files.guard.ensureInside(assetPath);
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error("Asset path must refer to a file");
    if (!/\.(png|jpg|jpeg|gif|mp3|ogg|wav|fbx|obj|glb)$/i.test(assetPath)) throw new Error("Unsupported local asset format");
    return text({
      path: path.relative(config.projectRoot, absolute).replaceAll("\\", "/"),
      size: stat.size,
      status: "available locally; Studio plugin must perform the live import"
    });
  });

  server.registerTool("roblox_get_asset_info", {
    description: "Inspect local asset metadata",
    inputSchema: z.object({ path: z.string().min(1).max(1000) })
  }, async ({ path: assetPath }) => {
    const absolute = await files.guard.ensureInside(assetPath);
    const stat = await fs.stat(absolute);
    return text({
      path: path.relative(config.projectRoot, absolute).replaceAll("\\", "/"),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      extension: path.extname(absolute).toLowerCase()
    });
  });

  server.registerTool("roblox_get_project_dependencies", {
    description: "Find scripts that reference a selected module or script",
    inputSchema: z.object({ path: z.string().min(1).max(1000) })
  }, async ({ path: modulePath }) => {
    const normalized = modulePath.replaceAll("\\", "/").replace(/^\.?\//, "");
    const baseName = path.basename(normalized).replace(/\.(lua|luau)$/i, "");
    const dependencies: Array<{ path: string; line: number; text: string }> = [];
    const entries = await files.list("");
    const scan = async (entry: { path: string; type: string }): Promise<void> => {
      if (entry.type === "directory") {
        for (const child of await files.list(entry.path)) await scan(child);
        return;
      }
      if (![".lua", ".luau"].includes(path.extname(entry.path).toLowerCase())) return;
      const script = await files.readScript(entry.path);
      script.content.split(/\r?\n/).forEach((line, index) => {
        if (line.includes(normalized) || line.includes(baseName)) dependencies.push({ path: script.path, line: index + 1, text: line.trim() });
      });
    };
    for (const entry of entries) await scan(entry);
    return text(dependencies);
  });

  server.registerTool("roblox_restore_backup", {
    description: "Restore a selected backup after explicit confirmation",
    inputSchema: z.object({ backupPath: z.string().min(1).max(1000), confirm: z.literal(true) })
  }, async ({ backupPath, confirm }) => {
    if (!confirm) throw new Error("Restore requires confirm=true");
    const absolute = path.resolve(config.backupRoot, backupPath);
    if (absolute !== config.backupRoot && !absolute.startsWith(config.backupRoot + path.sep)) throw new Error("Backup path escapes the backup directory");
    await fs.stat(absolute);
    await fs.cp(absolute, config.projectRoot, {
      recursive: true,
      force: true,
      filter: (source) => path.resolve(source) !== path.resolve(config.backupRoot)
    });
    return text({ restored: absolute });
  });

  server.registerTool("roblox_list_assets", {
    description: "List local asset files",
    inputSchema: z.object({ directory: z.string().optional() })
  }, async ({ directory }) => text((await files.list(directory, undefined)).filter((entry) => /\.(png|jpg|jpeg|gif|mp3|ogg|wav|fbx|obj|glb)$/i.test(entry.path))));

  server.registerResource("project-info", "roblox://project/info", { mimeType: "application/json", description: "Project information" }, async () => ({ contents: [{ uri: "roblox://project/info", text: JSON.stringify(await files.getProjectInfo(), null, 2) }] }));
  server.registerResource("project-structure", "roblox://project/structure", { mimeType: "application/json", description: "Project hierarchy" }, async () => ({ contents: [{ uri: "roblox://project/structure", text: JSON.stringify(await files.getStructure(), null, 2) }] }));
  server.registerResource("studio-connection", "roblox://studio/connection", { mimeType: "application/json", description: "Studio bridge connection status" }, async () => ({ contents: [{ uri: "roblox://studio/connection", text: JSON.stringify(bridge.status(), null, 2) }] }));
  server.registerResource("studio-output", "roblox://studio/output", { mimeType: "application/json", description: "Studio output" }, async () => {
    const result = await bridge.request("get_output", {}, config.bridgeTimeoutMs).catch((error: unknown) => ({ unavailable: error instanceof Error ? error.message : "Unavailable" }));
    return { contents: [{ uri: "roblox://studio/output", text: JSON.stringify(result, null, 2) }] };
  });

  const prompt = (name: string, title: string, textBody: string) => server.registerPrompt(name, { title, description: title }, async () => ({
    messages: [{ role: "user", content: { type: "text", text: textBody } }]
  }));
  prompt("create_feature", "Create a Roblox feature", "Inspect the project, identify relevant scripts and dependencies, propose an implementation, apply only authorized changes, validate, and report affected files.");
  prompt("debug_roblox_game", "Debug a Roblox game", "Retrieve available Studio errors, inspect related scripts, identify likely causes, propose a fix, apply it only when authorized, and run available validation.");
  prompt("review_project", "Review a Roblox project", "Inspect structure, find duplication, remote handling risks, performance issues, persistence concerns, and report findings by severity.");
  prompt("add_monetization", "Add monetization", "Inspect existing MarketplaceService code, verify ProcessReceipt and server-side Developer Product/Game Pass handling, and identify missing purchase safeguards.");

  return server;
}
