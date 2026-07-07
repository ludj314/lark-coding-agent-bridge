# Segmented Progress Cards Design

## Goal

Prevent long agent runs from flooding Lark groups with repeated large progress cards while still giving visible progress for genuinely long tasks.

## Confirmed Behavior

- Progress cards are segmented by content, not by time.
- Each progress card carries only one incremental segment of process output.
- Each progress card content should stay around 10,000 characters or less.
- Once a progress card reaches the segment limit, it stops receiving new process output.
- New process output goes into a local next-segment buffer.
- The next progress card is sent only when:
  - the previous progress card is full,
  - at least 2 minutes have elapsed since the previous progress card was created/sent,
  - and the next-segment buffer has content.
- A new progress card must not repeat content already shown in previous progress cards.
- On terminal state, the current visible progress card is updated immediately to done/error/interrupted/timeout.
- If there is buffered tail process content that was not sent because the 2-minute delay has not elapsed, do not send a separate tail process card at completion.
- Final summary policy remains:
  - failure/interruption/timeout: always send final summary,
  - success with duration >= 60 seconds: send final summary,
  - success with duration < 60 seconds: do not send extra summary.

## Non-goals

- Do not suppress messages that the agent explicitly sends through `lark-cli im send`.
- Do not add a user-facing config option yet.
- Do not change CoT publisher behavior in this change.

## Architecture

Bridge should stop using unbounded `markdown stream + setContent(full history)` for long progress output. Instead, it should own a segmented progress renderer/controller:

1. Convert each `RunState` update into compact progress markdown.
2. Maintain segment state: active segment content, queued next segment content, segment number, active message/card id, active segment creation time.
3. Render only new content into the current segment until the segment reaches about 10k.
4. Buffer additional process content for the next segment without duplicating prior content.
5. Send the next segment only after the 2-minute minimum interval.
6. Update the active segment to terminal state when the run ends.

## Rendering Rules

Each segment card should include a small header:

```text
进展更新 #N
已用时：XmYs
状态：正在调用工具 / 正在输出 / 已完成 / 失败 / 已中断 / 已超时
```

The body contains only that segment's process lines. Tool lines should remain compact. If a single rendered update would exceed the segment limit, truncate old portion or split at line boundaries so the emitted card stays under the limit.

## Error Handling

- If updating the active card fails, send a compact fallback progress card when allowed by the same segment interval rules.
- If terminal update fails, final summary still acts as the reliable notification path.
- Avoid SDK rollover by keeping each segment well under `@larksuite/channel`'s 30k markdown element limit.

## Testing

- Unit test segmentation: no segment exceeds 10k, next segment excludes prior content.
- Unit test interval: a full segment does not emit a next card before 2 minutes; it emits after 2 minutes when buffered content exists.
- Unit test terminal: terminal state updates current card immediately and does not emit an unsent tail process card.
- Integration/unit test prior regression shape: a long sequence of repeated full-state updates should not create many identical cards.
