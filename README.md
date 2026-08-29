# Koda

Koda is a verification and memory layer for coding-agent workflows. It reads a commit, selects focused browser/API/integration checks, writes JSON and Markdown reports, and remembers recurring failures.

## Quick start

```bash
npm install -g koda-verify
cd your-project
koda init
koda doctor
```

For local development, clone the repository and use `npm install` followed by `npm link`.

Koda keeps existing hooks, backs them up before appending, and defaults HTTP verification to read-only methods. If the app is not running, browser and endpoint checks are marked `SKIPPED`.

## Agent integration

```bash
claude mcp add koda -- npx -y koda-verify mcp
```

In a development checkout this also works as `claude mcp add koda node /absolute/path/to/koda/mcp/server.js`.

The MCP server exposes `koda_verify`, `koda_report`, `koda_memory`, and `koda_setup_cicd`. Agent-supplied flows are preferred; Groq is a fallback when no impact analysis is supplied.

## Development

```bash
npm run check
npm test
```

See [koda-v3-build-guide.md](./koda-v3-build-guide.md) for the full implementation contract.
