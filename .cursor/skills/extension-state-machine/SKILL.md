---
name: extension-state-machine
description: >-
  Chrome extension pilot state machine. Use when editing apps/extension,
  the popup, the hh overlay, background, reconcilePilot, autoQueue, the bot
  tab, tea, or search paging.
---

# Стейтмашина расширения

Всё поведение бота идёт через `apps/extension/src/chrome/pilot.ts`, функция `pilotStep(state, event)`.

Событие на вход, состояние на выход: включён или нет, закрывать вкладку бота или нет, текст статуса, можно ли начинать чай, какая следующая страница поиска.

Попап, фон, второй пилот, `reconcilePilot` и оверлей на hh только шлют событие и применяют ответ. Сами `autoQueue` не пишут и вкладку бота не закрывают. Второй писатель этих двух вещей запрещён.

`setFlags` хранит флаги. Решение закрыть вкладку принимает только `pilotStep`. Применяет его `applyPilot`.
