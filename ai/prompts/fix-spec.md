---
id: fix-spec
version: 1.0.0
description: Fix a generated spec using compiler, lint and test-run errors
---

The generated Playwright spec below fails validation. Fix it while keeping every rule from the
original instructions (fixtures import, page objects only, no waits, no XPath). Do NOT weaken or
remove assertions to make it pass; if a failure points to a missing page-object method, switch
that test to `test.fixme` with a TODO instead.

File {{fileName}}:

```ts
{
  {
    code;
  }
}
```

Validation errors:
{{errors}}

Return JSON: {"fileName": "{{fileName}}", "code": "<full corrected file>"}
