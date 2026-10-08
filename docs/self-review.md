# Self-review (Phase 11)

An honest list of what is weak, risky or missing, written when the 11 phases were implemented.

## Weaknesses

1. **The triage golden set was written together with the rules** (20 of 23; 3 come from real ShopQA failures) — 23/23 measures consistency, not
   real-world accuracy. Add real failures from nightly runs to `ai/evals/golden/triage-golden.json`
   (with the category a human confirmed) to get an honest number.
2. **Nothing was run against a real Azure DevOps organisation.** Every ADO call is unit-tested against
   the documented 7.1 request/response shapes with mocked HTTP; field names such as test-point paging,
   suite types and Test Case relation names should be confirmed in a sandbox project first.
3. **Two fixture entry points** (`fixtures/*` for existing specs, `src/fixtures` for new ones). The old
   specs still import from `fixtures/` and create page objects with `new` in a few places
   (`tests/ui/sanity/Logout.spec.ts`).
4. **Healer candidates are heuristic**: word overlap between a test id and accessible names. It refuses
   rather than guesses (ambiguous or non-unique matches), so it will often report "not healed".
5. **Story-to-test rule mode** produces skeletons with `test.fixme`; a human still writes the steps.
6. **Pass/fail timing in the dashboard** depends on polling (15 s) and the cache TTLs (10–60 s).
7. **Visual and HAR examples are documented, not committed** (the existing suites have no baselines yet).

## Flaky-test risks

- The shared free-tier backend (cold starts, 5xx under load) — mitigated with 1 CI worker per shard and
  API workers = 3, but load from parallel shards on the same backend can still cause 5xx. Watch the
  ENVIRONMENT share in triage.
- Tests that change shared seeded products (stock, coupons) rely on fixture cleanup; a killed run can
  leave state behind (e.g. a product left out of stock). Consider a nightly "reset seed data" QA endpoint.
- Account lockout after 5 failed logins on the fixed customer account (auth tests use fresh users;
  keep it that way).
- `fullyParallel: false` hides order dependencies inside files; turning it on later may reveal some.
- Dashboard UI tests use `vite preview` on port 4310; a busy port fails the run (`strictPort`).

## Security concerns

- The prompt pack in `.github/AI_Agentic_Playwright_Build_Prompts.md` contains real test credentials:
  **do not commit it as is**; credentials belong in `.env`/Key Vault only. Rotate them if they were shared.
- `DEFAULT_PASSWORD` for generated users is in `test-data/users.ts` (test-only accounts) — acceptable,
  but keep it out of any real environment.
- Dashboard: basic auth only; use Entra ID (App Service Easy Auth) before exposing it beyond a VPN.
  The dashboard can queue pipelines: limit who can reach it.
- The build service needs Contribute + PR permissions for agents: scope it to this repo only.
- HAR recordings and traces can contain personal data: keep artifact retention short.
- LLM redaction is regex-based: it cannot catch every name or free-text identifier. Keep the
  `REDACT_NAMES` list and data classification under review before enabling an external LLM.

## Next 5 improvements

1. Feed real nightly failures into the golden set and add a weekly accuracy report (rules vs rules+LLM).
2. Migrate existing specs to `src/fixtures` and add `@TC-<id>` (or overrides) for the Test Cases that
   matter for release sign-off, so Test Plan results are meaningful.
3. Add visual baselines (generated in Docker) and `a11y.check()` to the key storefront pages
   (home, product, cart, checkout).
4. A "test data health" pre-check stage (backend up, seeded products in stock, admin login works) that
   fails fast with an ENVIRONMENT verdict instead of hundreds of red tests.
5. Replace basic auth with Entra ID and add a small role model (viewer vs. can-start-runs) in the dashboard.
