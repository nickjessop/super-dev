# Update Super Dev

Call the `super_dev_update` tool to update Super Dev. It will:

1. Sync skills — symlinks from this repo's `skills/` into `~/.agents/skills/`
2. Pull the latest changes from git
3. Rebuild the server

After it finishes, restart the MCP server in Zed for tool/prompt changes to take effect (skills update immediately via symlinks).
