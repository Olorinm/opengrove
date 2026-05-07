---
title: Browser Action Safety
description: 在浏览器动作前先观察，再把可能有副作用的步骤放进可确认的执行链路里。
when_to_use: 当任务需要在网页里观察、点击、输入或提交内容时。
allowed-tools:
  - browser.observe
  - browser.requestAct
user-invocable: true
disable-model-invocation: false
capability: cap.browser-stagehand-act
pack: pack.browser-action-core
activities:
  - browser
tool-ids:
  - browser.observe
  - browser.requestAct
tags:
  - browser
  - action
  - safety
---
# Browser Action Safety

Use browser action tools only when the user is clearly asking for a page interaction.

Rules:

1. Observe first. Use `browser.observe` to understand the page boundary before proposing an action.
2. Prefer drafts and staged actions. Do not imply that a browser action has happened unless the tool result says it happened.
3. Ask before side effects. `browser.requestAct` is approval-gated and only returns a staged action plan until the user confirms it.
4. Be precise. Include the target, intended effect, and why the action is needed.
5. Stop on sensitive pages such as payment, banking, password, medical, or account security flows unless the user explicitly continues and the policy allows it.
