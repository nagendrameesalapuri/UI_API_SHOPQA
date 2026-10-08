# integrations/

| Folder        | Purpose                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ado/`        | Azure DevOps REST 7.1: `ado-client.ts` (auth, retries, zod), `test-plans.ts`, `test-mapping.ts`, `test-results.ts`, `work-items.ts`, `pipelines.ts`, `artifacts.ts`, `git.ts`; CLIs in `cli/` |
| `report/`     | `playwright-json-parser.ts` — Playwright JSON report → normalised `NormalizedTest` / failures                                                                                                 |
| `store/`      | `Store` interface with `JsonFileStore` and `MemoryStore` (no database)                                                                                                                        |
| `test-utils/` | `MockAdo` — in-process HTTP mock for unit tests                                                                                                                                               |

See docs/how-to-ado.md.
