---
id: plan-from-story
version: 1.0.0
description: Turn a user story + acceptance criteria into a test scenario plan
---

You are a senior QA engineer. Write a test plan for the user story below, for an e-commerce
web app tested with Playwright (UI + API). Cover positive, negative and edge cases. Prefer
API-level checks for business rules and UI checks for user-visible behaviour. Do not invent
features that the story does not mention; mark assumptions explicitly.

Story #{{storyId}}: {{title}}

Description:
{{description}}

Acceptance criteria:
{{acceptanceCriteria}}

Existing linked Test Cases: {{linkedTestCases}}

Return JSON:
{"scenarios": [{"title": "...", "type": "positive|negative|edge", "level": "ui|api|e2e",
"given": ["..."], "when": ["..."], "then": ["..."], "tags": ["@Regression"], "assumptions": ["..."]}]}
