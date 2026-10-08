# How to use the Playwright Test Agents and the Story-to-Test agent

## IDE agents (planner → generator → healer)

Generated with `npx playwright init-agents --loop=vscode --project=chromium` and `--loop=claude`:

| Editor                       | Files                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| VS Code (Copilot agent mode) | `.github/agents/playwright-test-{planner,generator,healer}.agent.md`, `.vscode/mcp.json` |
| Claude Code                  | `.claude/agents/playwright-test-*.md`, `.mcp.json`                                       |
| GitHub Copilot coding agent  | `.github/workflows/copilot-setup-steps.yml`                                              |

All use the `playwright-test` MCP server (`npx playwright run-test-mcp-server`) and the seed test
`tests/seed.spec.ts`, which logs in as a customer via our fixtures (`asRole`) and uses a page object —
so generated tests copy our style. Conventions they must follow are in `AGENTS.md`
(mirrored to `CLAUDE.md` and `.github/copilot-instructions.md`).

Workflow:

1. **Planner**: "Plan tests for applying coupons in the cart" → writes `specs/<name>.md`. Review it.
2. **Generator**: "Generate tests for specs/coupons.md" → writes specs. Then move raw locators into
   page objects (the generator works from the live page; our rule is _no raw locators in specs_).
3. **Healer**: "Fix the failing test tests/ui/…" → it runs, inspects and patches. Review the diff: it
   must not change assertions.

Re-run `npx playwright init-agents --loop=<vscode|claude>` after upgrading Playwright to refresh them.

## Story-to-Test agent (CLI and pipeline)

```bash
npm run agent:story -- --story-file ai/evals/fixtures/story-1234.json --dry-run   # offline demo
npm run agent:story -- --id 1234 --dry-run                                         # real story, files only
npm run agent:story -- --id 1234 [--create-test-cases]                             # branch + draft PR
```

1. Fetches the story, acceptance criteria and linked Test Cases.
2. Plans scenarios: Gherkin (Scenario/Given/When/Then/And), bullet or numbered lists, or free text are
   parsed by rules (`LLM_PROVIDER=none`); with an LLM, `prompts/plan-from-story.md` gives a richer plan.
3. Optionally creates Test Cases (linked _Tested By_ to the story) and tags scenarios `@TC-<id>`.
4. Writes `specs/story-<id>.md` and `tests/ui/stories/story-<id>.spec.ts`:
   - none: a compilable skeleton, `test.fixme` per scenario, `test.step` per Given/When/Then/And,
     comments with candidate page-object methods (e.g. `cartPage.applyCoupon(code: string)`).
   - LLM: a generated spec, validated with tsc + eslint + 3 runs; up to 2 fix rounds via
     `prompts/fix-spec.md`, then marked _needs human_.
5. Commits to `ai/story-<id>` and opens a **draft** PR labelled `ai-generated`, linked to the story,
   listing scenarios, Test Case ids, validation and TODOs. It never merges.

Pipeline: `ai-story-to-test.yml` (parameters `storyId`, `createTestCases`).

## Healer agent (CLI)

```bash
npm run triage                       # produces reports/ai-triage.json
npm run agent:heal -- --dry-run      # proposes + validates, prints the diff, leaves files unchanged
npm run agent:heal                   # applies; with ADO configured opens a draft PR
```

Only TEST_ISSUE/locator failures. It finds the page-object line defining the broken locator, proposes
replacements from the accessibility snapshot in `error-context.md` (and the LLM if configured), applies
one, re-runs the failing test, keeps it only if it passes (max 2 attempts), and never edits specs or
lines with assertions.
