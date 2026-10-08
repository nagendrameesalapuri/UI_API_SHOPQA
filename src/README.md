# src/

Framework core added around the existing shop-app code (`pages/`, `api/`, `fixtures/`, `test-data/`).

| Folder                  | Purpose                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `config/`               | `env.ts` (zod-validated config, fail fast), `environments/<TEST_ENV>.env` (non-secret values)                  |
| `fixtures/`             | `index.ts` — single import for new specs (shop fixtures + `asRole`, `a11y`, `network`); `dashboard.fixture.ts` |
| `api/`                  | `base.client.ts` — base class for new API clients                                                              |
| `data/builders/`        | Test-data builders (`dashboard.builder.ts`); shop builders stay in `test-data/`                                |
| `pages/`, `components/` | Reserved for new page objects / reusable widgets (the healer also looks here)                                  |
| `utils/`                | `logger.ts` (JSON lines + secret masking), `matchers.ts` (custom `expect` matchers)                            |
