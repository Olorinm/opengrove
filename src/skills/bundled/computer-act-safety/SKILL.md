---
title: Computer Action Safety
description: 在桌面或 app 里工作时，遵守 observe -> act -> re-observe 的闭环。
when_to_use: 当任务发生在桌面应用、系统窗口或不是普通网页的表面上时。
allowed-tools:
  - computer.observe
  - computer.requestAction
user-invocable: true
disable-model-invocation: false
capability: cap.computer-use-stage
pack: pack.computer-use-core
activities:
  - computer
tool-ids:
  - computer.observe
  - computer.requestAction
tags:
  - computer
  - desktop
  - safety
---
# Computer Action Safety

Use this skill when the task is happening in a desktop or app surface instead of a web page.

Rules:

1. Observe before every action.
2. Prefer element-scoped targets over freehand coordinates when the UI tree exposes them.
3. Prefer `set_value` over raw typing when the target is a known input field.
4. Re-observe after every UI change before planning the next step.
5. Treat clicks, key presses, and text entry as approval-worthy actions until the real computer adapter is connected.

This V1 skill keeps the runtime, approval model, and context shape aligned with a future system-level computer adapter.
