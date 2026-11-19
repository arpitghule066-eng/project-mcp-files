# Roblox Studio MCP plugin

This plugin provides live DataModel access for the MCP server. Install `src/RobloxStudioMcp.server.lua` as a Studio plugin or run it in a test plugin environment.

## Setup

1. Set `BRIDGE_TOKEN` in the Luau plugin to exactly the value of `ROBLOX_STUDIO_BRIDGE_TOKEN`.
2. Start the MCP bridge with `npm start`.
3. Open the plugin in Roblox Studio.
4. The plugin polls `127.0.0.1:17483` and sends results back only with the matching bearer token.

## Supported operations

- Instance tree and property reads
- Selected-instance reads
- Instance finding
- Creation and updates for allowlisted classes and properties
- Confirmed instance deletion
- Output/test status reporting is explicitly unavailable unless additional Studio APIs are connected

The plugin does not expose arbitrary classes or properties.
