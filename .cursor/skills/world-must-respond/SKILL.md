---
name: world-must-respond
description: >-
  The world must respond when the user acts or the product hands them something.
  Use when changing UI or persisting a setting: buttons, toggles, pastes, submits,
  saves, forms, and any control that accepts input. A control that stays visually
  identical after the action is a bug.
---

# The world must respond

If the player does something, the world answers. If you hand them something, the world shows they have it. Silence after an action is a bug.

A button, toggle, paste, or submit that takes input and looks the same afterward is broken. Answer in that same control, in the same view.

## Good

- The control itself changes: label, color, checked, disabled.
- A short result line on that control: saved, replaced, the new value.
- A short error on that same control when the input is wrong.

## Not an answer

- A toast off to the side.
- A console log.
- A sentence in chat while the UI stays still.
