# dashboard/ — Release Dashboard

`server/` Express API (`app.ts` routes, `ado-service.ts` real, `mock-service.ts` demo), `web/` React +
Vite app, `shared/contracts.ts` zod contracts used by both, `playwright.config.ts` for its UI tests.

```bash
DASHBOARD_MOCK=true npm run dashboard:dev   # demo at http://localhost:4300
npm run test:dashboard                      # UI tests (API mocked)
```

See docs/how-to-dashboard.md.
