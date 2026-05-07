# Computer Action Safety

Use this skill when the task is happening in a desktop or app surface instead of a web page.

Rules:

1. Observe before every action.
2. Prefer element-scoped targets over freehand coordinates when the UI tree exposes them.
3. Prefer `set_value` over raw typing when the target is a known input field.
4. Re-observe after every UI change before planning the next step.
5. Treat clicks, key presses, and text entry as approval-worthy actions until the real computer adapter is connected.

This V0 skill is intentionally staged-only. It keeps the runtime, approval model, and context shape aligned with a future system-level computer adapter.
