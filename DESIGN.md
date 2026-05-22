# OpenGrove Design Guide

OpenGrove should feel like a quiet professional workspace for long agent work:
local-first, precise, readable, and calm. It is an operational app, not a
marketing site or a neon agent dashboard.

## Visual System

- Use a low-saturation light UI by default: gray outer shell, white active
  workspace, fine borders, restrained shadows.
- Use blue for interaction: selected states, focus, primary actions, live work,
  and active markers.
- Use green for OpenGrove identity and true success: logo, connected, saved,
  accepted, done.
- Do not turn the whole UI green. Avoid gradients, glows, decorative orbs, and
  color washes.
- Dark theme should remain a premium workspace, not a terminal skin.

## Typography

Use system UI fonts:

```css
font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text",
  "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", sans-serif;
```

- Workspace title: 26-28px, 600.
- Section title: 16-18px, 600.
- Body text: 14-15px, regular.
- Dense UI text: 12-13px, regular/500.
- Code/log text: 12-13px mono.
- Avoid oversized headings inside tool surfaces. Keep letter spacing at `0`.

## Layout

The app shell has three product areas:

| Area | Role |
| --- | --- |
| Left rail | Global navigation and app identity |
| Context sidebar | Project, thread, room, folder, or object navigation |
| Main workspace | The active conversation, document, app, room, or preview |

Rules:

- Do not bury main objects inside nested cards.
- Use rows for dense operational settings.
- Use cards only for repeated items, modals, dialogs, and genuinely framed
  tools.
- Sidebar popovers must render above clipped scroll containers.
- Every view needs loading, empty, unavailable, error, and active states.

## Interaction Controls

- Use lucide icons for common controls.
- Icon-only controls need accessible labels and tooltips.
- Use toggles for enabled/disabled, segmented controls for modes, inline selects
  for compact choices, and list rows for settings.
- Buttons should express commands, not labels for passive state.
- Status colors should be rare. Prefer neutral tags until a warning, failure, or
  completed success is meaningful.

## Chat And Rooms

- Chat should foreground the current turn and context.
- The composer is the primary input device: clean white surface, fine hairline,
  quiet controls, familiar icons for attach, mic, model, access, and send.
- Rooms must never be blank. Show useful states for no rooms, no members,
  remote unavailable, empty room, active conversation, and errors.
- Contacts are explicit entities. Do not auto-create employees from newly
  detected kernels.

## Knowledge And Apps

- Knowledge should feel like a local file workspace: tree, document, properties,
  markdown/code readability, and a secondary AI panel.
- App developer mode is a state of a mounted App, not a separate task system.
  Preview URL, annotations, selected element context, voice notes, and run
  metadata attach to a normal conversation thread.
- Visual workbench surfaces should prioritize the preview/artifact, then
  annotations and chat.

## Copy

- Keep UI copy direct and operational.
- Do not use marketing explanations inside the app.
- Chinese copy should be concise and natural, not slogan-like.
- Error text should name the blocked action and the next recovery step.
