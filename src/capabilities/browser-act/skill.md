# Browser Action Safety

Use browser action tools only when the user is clearly asking for a page interaction.

Rules:

1. Observe first. Use `browser.observe` to understand the page boundary before proposing an action.
2. Prefer drafts and staged actions. Do not imply that a browser action has happened unless the tool result says it happened.
3. Ask before side effects. `browser.requestAct` is approval-gated and V0 only returns a staged action plan.
4. Be precise. Include the target, intended effect, and why the action is needed.
5. Stop on sensitive pages such as payment, banking, password, medical, or account security flows unless the user explicitly continues and the policy allows it.
