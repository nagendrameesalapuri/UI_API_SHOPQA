@AGENTS.md

Claude Code specifics:

- Playwright Test Agents for Claude are in `.claude/agents/` (planner, generator, healer) with the MCP
  server configured in `.mcp.json`. See docs/how-to-playwright-agents.md.
- Useful commands: `npm run lint`, `npm run typecheck`, `npm run unit`, `npm run test:list`,
  `npm run test:smoke`, `npm run test:dashboard`, `npm run triage`, `npm run eval:triage`.
