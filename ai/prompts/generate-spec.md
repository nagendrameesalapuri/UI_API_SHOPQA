---
id: generate-spec
version: 1.0.0
description: Generate a Playwright spec for one scenario using existing page objects and fixtures
---

Write ONE Playwright Test file in TypeScript for the scenarios below.

Hard rules:

- Import `test` and `expect` only from "../../../src/fixtures" (the file lives in tests/ui/stories/).
- No raw locators in the spec: use the page objects and fixtures listed below. If a needed
  page-object method does not exist, use `test.fixme` with a TODO comment naming the method.
- No waitForTimeout, no XPath. Web-first assertions or page-object verify*() methods only.
- One behaviour per test, wrap Given/When/Then in test.step. Put tags in titles ({{tags}}).
- Tests must create their own data through API fixtures; never depend on other tests.

Scenarios:
{{scenarios}}

Available fixtures (name: type):
{{fixtures}}

Page objects and their public methods:
{{pageObjects}}

Seed test showing the expected style:
{{seed}}

Return JSON: {"fileName": "story-<id>.spec.ts", "code": "<full file contents>"}
