# MCP server

Exposes the workspace to Claude over local stdio. Every call runs under the
signed-in user's RLS — the server holds no service-role key.

## Setup

Credentials come from `.env.local`:

```
MCP_USER_EMAIL=you@example.com      # falls back to SEED_USER_EMAIL
MCP_USER_PASSWORD=...               # falls back to SEED_USER_PASSWORD
```

The repo ships a project-scoped `.mcp.json`, so opening this folder in Claude
Code offers the server automatically — approve it when prompted, then check
with `/mcp`.

To register it manually instead (CLI):

```bash
claude mcp add workspace -- npx tsx /Users/us/Documents/personalworkspace/mcp/server.mts
```

Or in Claude Desktop's config:

```json
{
  "mcpServers": {
    "workspace": {
      "command": "npx",
      "args": ["tsx", "/Users/us/Documents/personalworkspace/mcp/server.mts"]
    }
  }
}
```

Requires Node 22+ (`.nvmrc`); supabase-js needs native WebSocket support.

Verify it end to end (drives the real server, cleans up after itself):

```bash
npm run mcp:check
```

## Tools

| Tool | Purpose |
| --- | --- |
| `search` | Find pages by title or block text; returns page ids |
| `read_page` | Page as markdown, plus sub-pages and row property values |
| `create_page` | New page, optionally nested, optionally with markdown |
| `append_blocks` | Append markdown to a page as real blocks |
| `list_databases` | Databases with their properties and select options |
| `query_database` | Rows with filters and sorts (properties by name or id) |
| `create_row` | New row; values may use option names; markdown allowed |
| `update_row_properties` | Update row values and title |

Property values are forgiving: `{"Status": "Done"}` resolves the property by
name and the option by label, so Claude does not need to know internal ids.
