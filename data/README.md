# data/ — JSON stores (no database)

| File                  | Written by               | Purpose                                                                                              |
| --------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `tc-mapping.json`     | `npm run ado:map-tests`  | Tests ↔ Azure Test Cases, unmapped tests                                                             |
| `tc-overrides.json`   | you                      | `"file > describe > title": <TestCaseId>` for tests without `@TC-<id>` tags                          |
| `known-issues.json`   | you                      | `[{ "id", "pattern", "category", "kind", "reason", "bugId" }]` — overrides triage for known failures |
| `triage-history.json` | `npm run triage` (local) | Last 30 runs, compact; pipelines rebuild it from artifacts                                           |
| `redact.example.json` | —                        | Copy to `redact.json` to add redaction patterns / names                                              |
