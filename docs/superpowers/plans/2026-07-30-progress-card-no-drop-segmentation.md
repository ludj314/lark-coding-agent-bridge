# Progress Card No-Drop Segmentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent progress-card content loss by rolling overflow into follow-up cards without the 2-minute gate.

**Architecture:** Keep `ProgressSegmenter` as the owner of progress slicing. Change it from a hard-truncating segmenter to a soft-threshold segmenter: a segment may exceed the target until a sentence/line boundary appears, then future content starts a pending next segment. Runtime updates only emit the next segment after its body has at least the configured minimum, while terminal drain emits every remaining tail segment.

**Tech Stack:** TypeScript, Vitest, existing Lark channel progress-card sender.

## Global Constraints

- Use TDD: write failing tests, verify red, then implement.
- Default progress body target is 10000 characters.
- Once the active card is complete, emit the next running card only after at least 500 characters have accumulated.
- On terminal, emit remaining content even if it is below 500 characters.
- Do not split in the middle of an unfinished sentence when the active card first crosses the 1000-character target; allow it to exceed 1000 until a readable boundary appears.
- Do not restore the 2-minute throttle.
- Do not lose or duplicate progress text across segments.

---

### Task 1: Segmenter no-drop behavior

**Files:**
- Modify: `tests/unit/card/progress-segments.test.ts`
- Modify: `tests/unit/card/progress-segments-regression.test.ts`
- Modify: `src/card/progress-segments.ts`

**Interfaces:**
- Consumes: `ProgressSegmenter.update(state: RunState): ProgressSegment | undefined`, `ProgressSegmenter.markSent(segment: ProgressSegment): void`
- Produces: `ProgressSegmenter.terminalSegments(state: RunState): ProgressSegment[]`

- [ ] **Step 1: Write failing tests**

Add tests proving:

```ts
it('starts the next card after a completed segment has at least the configured minimum tail', () => {
  const segmenter = new ProgressSegmenter({ maxChars: 80, nextSegmentMinChars: 20, now: () => 0 });
  const firstText = `${'A'.repeat(70)}.\n${'B'.repeat(10)}`;
  const first = segmenter.update(stateWithText(firstText));
  expect(first?.index).toBe(1);
  expect(first?.content).toContain('A'.repeat(70));
  expect(first?.content).not.toContain('B'.repeat(10));
  segmenter.markSent(first!);

  expect(segmenter.update(stateWithText(`${firstText}${'B'.repeat(9)}`))).toBeUndefined();

  const second = segmenter.update(stateWithText(`${firstText}${'B'.repeat(10)}`));
  expect(second?.index).toBe(2);
  expect(second?.content).toContain('B'.repeat(20));
  expect(second?.content).not.toContain('A'.repeat(50));
});

it('terminal drain emits a short remaining tail without waiting for the minimum', () => {
  const segmenter = new ProgressSegmenter({ maxChars: 80, nextSegmentMinChars: 50, now: () => 0 });
  const text = `${'A'.repeat(70)}.\nshort tail`;
  const first = segmenter.update(stateWithText(text));
  segmenter.markSent(first!);

  const terminal = segmenter.terminalSegments({ ...stateWithText(text), terminal: 'done', footer: null });
  expect(terminal.map((segment) => segment.index)).toEqual([1, 2]);
  expect(terminal[0].content).toContain('✅ 已完成');
  expect(terminal[1].content).toContain('short tail');
});

it('keeps an unfinished sentence on the same card past the soft limit', () => {
  const segmenter = new ProgressSegmenter({ maxChars: 80, nextSegmentMinChars: 20, now: () => 0 });
  const first = segmenter.update(stateWithText('A'.repeat(140)));
  expect(first?.index).toBe(1);
  expect(first?.content).toContain('A'.repeat(140));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/card/progress-segments.test.ts tests/unit/card/progress-segments-regression.test.ts`
Expected: FAIL because `nextSegmentMinChars` / `terminalSegments` do not exist and overflow is currently discarded.

- [ ] **Step 3: Implement minimal segmenter changes**

Update `src/card/progress-segments.ts` so:

```ts
export const PROGRESS_SEGMENT_MAX_CHARS = 1_000;
export const PROGRESS_SEGMENT_NEXT_MIN_CHARS = 500;
```

Constructor accepts `nextSegmentMinChars?: number`. `update()` splits only at readable boundaries once a segment has crossed `maxChars`, leaves overflow pending, and emits pending segments once they reach `nextSegmentMinChars`. `terminalSegments()` returns the active terminal segment plus all pending tail segments, ignoring the next-min gate.

- [ ] **Step 4: Run tests to verify green**

Run: `pnpm vitest run tests/unit/card/progress-segments.test.ts tests/unit/card/progress-segments-regression.test.ts`
Expected: PASS.

---

### Task 2: Channel terminal drain

**Files:**
- Modify: `src/bot/channel.ts:1094-1106`
- Modify: `tests/unit/bot/progress-card-upsert.test.ts` or add a focused unit test if a direct channel test exists.

**Interfaces:**
- Consumes: `ProgressSegmenter.terminalSegments(state: RunState): ProgressSegment[]`
- Produces: markdown reply mode sends every terminal segment through `upsertProgressCard`.

- [ ] **Step 1: Write failing test**

Add or update a test proving terminal handling calls `upsertProgressCard` for multiple terminal segments when the segmenter has buffered tail content.

- [ ] **Step 2: Run the test and verify red**

Run the focused bot test.
Expected: FAIL because channel only calls `segmenter.terminal(...)` once.

- [ ] **Step 3: Implement channel loop**

Replace:

```ts
const terminal = segmenter.terminal(filterForPrefs(finalState));
if (terminal) {
  await upsertProgressCard({ ... segment: terminal ... });
}
```

with:

```ts
for (const terminal of segmenter.terminalSegments(filterForPrefs(finalState))) {
  await upsertProgressCard({ ... segment: terminal ... });
}
```

- [ ] **Step 4: Run focused tests and full unit tests**

Run: `pnpm vitest run tests/unit/card/progress-segments.test.ts tests/unit/card/progress-segments-regression.test.ts tests/unit/bot/progress-card-upsert.test.ts`
Expected: PASS.

Run: `pnpm test`
Expected: PASS.

---

## Self-Review

- Spec coverage: no-drop overflow, no 2-minute throttle, 500-char next-card gate, terminal short-tail flush, and sentence-boundary overflow are covered by Task 1 and Task 2.
- Placeholder scan: no TODO/TBD placeholders remain.
- Type consistency: `terminalSegments(state): ProgressSegment[]` is the only new public method used by channel code.
