---
id: skill.opengrove-developer-mode-guard
title: OpenGrove Developer Mode Guard
description: Keep OpenGrove app developer-mode requests scoped to the user project and separated from the OpenGrove host application.
when-to-use: Use whenever a task comes from OpenGrove app developer mode, preview annotations, preview URLs, sketch input, voice notes, or TaskContextPacket data.
tags:
  - opengrove
  - developer-mode
  - guardrail
---

# OpenGrove Developer Mode Guard

When a request arrives from OpenGrove app developer mode, treat OpenGrove as the host, the selected Core as the executor, and the target root as the user's project.

Follow these rules:

- Modify only files under the provided `targetRoot` or `constraints.allowedRoots`.
- Do not modify OpenGrove host files, settings, docs, or bundled skills unless the user explicitly asks to change OpenGrove itself.
- Use the preview annotations, preview URL, transcript, and request description as implementation context.
- Keep changes small, reviewable, and directly tied to the user's developer-mode request.
- Before reporting completion, summarize changed files, how the result was checked, and any preview refresh the user should do.
- If the request cannot be completed without touching files outside the allowed roots, stop and explain the boundary conflict.
