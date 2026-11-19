# Roblox Studio MCP

Production-oriented MCP server for filesystem-based Roblox project workflows and a secure local bridge to Roblox Studio.

## What is supported

- **Filesystem operations:** project inspection, Luau reads/writes, local searches, structural validation, backups and restores.
- **Rojo detection:** detects common Rojo project files. Live synchronization status is only available through the Studio plugin.
- **Studio bridge:** live DataModel operations require the included plugin and an authenticated HTTP bridge bound to `127.0.0.1`.
- **Security:** project path confinement, Zod input schemas, 1 MB bridge payload limit, timeouts, destructive-operation confirmation and backups.

## Install

```powershell
npm install
npm run build
npm test
```

## Configure

Copy `.env.example` to `.env` and set:

- `ROBLOX_PROJECT_PATH` to the absolute or relative project root.
- `ROBLOX_STUDIO_BRIDGE_PORT` to a local port (default `17483`).
- `ROBLOX_STUDIO_BRIDGE_TOKEN` to a random secret shared with the Studio plugin.

The server generates a random bridge token when the environment variable is not set, but the plugin must receive the same value.

## Run

```powershell
npm start
```

For development:

```powershell
npm run dev
```

## VS Code / Copilot MCP configuration

Create or update `.vscode/mcp.json`:

```json
{
  "servers": {
    "roblox": {
      "type": "stdio",
      "command": "node",
      "args": ["C:\\\\absolute\\\\path\\\\to\\\\project-mcp-files-1\\\\dist\\\\index.js"],
      "env": {
        "ROBLOX_PROJECT_PATH": "C:\\\\absolute\\\\path\\\\to\\\\your\\\\roblox\\\\project",
        "ROBLOX_STUDIO_BRIDGE_PORT": "17483",
        "ROBLOX_STUDIO_BRIDGE_TOKEN": "replace-with-a-random-local-token"
      }
    }
  }
}
```

## Cursor configuration

Configure a stdio server with command `node` and args pointing to `dist/index.js`; set the same environment variables.

## Claude Code configuration

```powershell
claude mcp add roblox -- node C:\absolute\path\to\project-mcp-files-1\dist\index.js
```

Set `ROBLOX_PROJECT_PATH` and bridge variables in the server process environment.

## Tools

The server implements project inspection and Luau management tools, local validation and analysis, asset listing, backups/restores, and registered live Studio operation names. Live DataModel tools return a disconnected-bridge error until the plugin is installed and authenticated.

Destructive operations require `confirm: true`. Script edits create backups by default.