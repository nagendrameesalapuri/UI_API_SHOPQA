---
id: heal-locator
version: 1.0.0
description: Propose a replacement locator for a broken page-object field
---

A Playwright page-object locator no longer matches the page. Propose a replacement.

Locator priority (use the first that uniquely identifies the element):
getByRole (with name) > getByLabel > getByTestId > getByText > CSS. Never XPath.

Page object: {{pageObject}}
Field: {{field}}
Current locator expression: {{currentLocator}}
Failing step: {{failingStep}}
Error:
{{error}}

Accessibility snapshot of the page at failure (redacted):
{{snapshot}}

Rule-based candidates already found: {{candidates}}

Return JSON: {"locator": "page.getByRole('button', { name: 'Checkout' })", "confidence": 0.0-1.0, "reason": "..."}
Only return a locator expression that starts with `page.` and uses the priority above.
