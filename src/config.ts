import path from "node:path";
import crypto from "node:crypto";

export interface AppConfig {
  projectRoot: string;
  bridgePort: number;
  bridgeToken: string;
  bridgeTimeoutMs: number;
  backupRoot: string;
}

export function loadConfig(): AppConfig {
  const projectRoot = path.resolve(process.env.ROBLOX_PROJECT_PATH ?? process.cwd());
  const bridgePort = Number(process.env.ROBLOX_STUDIO_BRIDGE_PORT ?? "17483");
  if (!Number.isInteger(bridgePort) || bridgePort < 1024 || bridgePort > 65535) {
    throw new Error("ROBLOX_STUDIO_BRIDGE_PORT must be an integer between 1024 and 65535");
  }

  return {
    projectRoot,
    bridgePort,
    bridgeToken: process.env.ROBLOX_STUDIO_BRIDGE_TOKEN ?? crypto.randomBytes(32).toString("hex"),
    bridgeTimeoutMs: Number(process.env.ROBLOX_STUDIO_BRIDGE_TIMEOUT_MS ?? "5000"),
    backupRoot: path.join(projectRoot, ".backups")
  };
}
