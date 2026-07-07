# Segmented Progress Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent long agent runs from creating repeated large Lark progress cards by segmenting progress output into non-overlapping ~10k cards spaced at least 2 minutes apart.

**Architecture:** Add a focused progress segmenter that tracks rendered process lines independently from `RunState`, so each card gets only new segment content. Wire markdown/card reply modes through this segmenter instead of repeatedly streaming the full accumulated `RunState`. Keep final summary logic unchanged except that terminal card update is immediate and unsent tail process content is not emitted as a separate process card.

**Tech Stack:** TypeScript, Vitest, existing `RunState` reducers/renderers, `@larksuite/channel` send/update APIs.

## Global Constraints

- Progress cards are segmented by content, not by time.
- Each progress card carries only one incremental segment of process output.
- Each progress card content should stay around 10,000 characters or less.
- Once a progress card reaches the segment limit, it stops receiving new process output.
- New process output goes into a local next-segment buffer.
- The next progress card is sent only when the previous progress card is full, at least 2 minutes have elapsed since the previous progress card was created/sent, and the next-segment buffer has content.
- A new progress card must not repeat content already shown in previous progress cards.
- On terminal state, the current visible progress card is updated immediately to done/error/interrupted/timeout.
- If there is buffered tail process content that was not sent because the 2-minute delay has not elapsed, do not send a separate tail process card at completion.
- Failure/interruption/timeout always sends final summary; success with duration >= 60 seconds sends final summary; success with duration < 60 seconds does not send extra summary.
- Do not suppress messages that the agent explicitly sends through `lark-cli im send`.
- Do not add a user-facing config option yet.
- Do not change CoT publisher behavior in this change.

---

## File Structure

- Create `src/card/progress-segments.ts`
  - Owns segmentation state and compact rendering for progress cards.
  - Exports `ProgressSegmenter`, `ProgressSegment`, constants `PROGRESS_SEGMENT_MAX_CHARS = 10_000`, `PROGRESS_SEGMENT_MIN_INTERVAL_MS = 120_000`.
- Create `tests/unit/card/progress-segments.test.ts`
  - Verifies no segment exceeds 10k, no duplicated content across segments, 2-minute gate, terminal flush behavior.
- Modify `src/bot/channel.ts`
  - Replace unbounded `channel.stream(... markdown.setContent(renderText(full state)))` in markdown mode with segmented progress card sends/updates.
  - Replace card mode unbounded streaming updates with segmented card sends/updates using `renderCard` over segment state.
  - Preserve final summary policy from previous commit.
- Modify `tests/helpers/fake-channel.ts` only if current helper lacks methods needed for progress segment send/update assertions.
- Add or modify focused tests under `tests/unit/bot/final-answer-fallback.test.ts` or a new `tests/unit/bot/segmented-progress.test.ts` if channel orchestration can be tested without large integration setup.

---

### Task 1: Build pure progress segmenter

**Files:**
- Create: `src/card/progress-segments.ts`
- Test: `tests/unit/card/progress-segments.test.ts`

**Interfaces:**
- Consumes: `RunState` from `src/card/run-state.ts` and `renderText` from `src/card/text-renderer.ts`.
- Produces:
  - `export const PROGRESS_SEGMENT_MAX_CHARS = 10_000;`
  - `export const PROGRESS_SEGMENT_MIN_INTERVAL_MS = 120_000;`
  - `export interface ProgressSegment { index: number; content: string; terminal: boolean; }`
  - `export class ProgressSegmenter { constructor(opts?: { maxChars?: number; minIntervalMs?: number; now?: () => number }); update(state: RunState): ProgressSegment | undefined; markSent(segment: ProgressSegment): void; terminal(state: RunState): ProgressSegment | undefined; }`

- [ ] **Step 1: Write failing segmenter tests**

Create `tests/unit/card/progress-segments.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { ProgressSegmenter } from '../../../src/card/progress-segments.js';
import type { RunState } from '../../../src/card/run-state.js';

describe('ProgressSegmenter', () => {
  it('keeps one progress segment under the configured character cap', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 120, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithText('A'.repeat(200)));

    expect(first?.content.length).toBeLessThanOrEqual(120);
    expect(first?.content).toContain('进展更新 #1');
  });

  it('does not emit a second segment before the minimum interval elapses', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 120, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithText('A'.repeat(200)));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    now = 60_000;
    const second = segmenter.update(stateWithText('A'.repeat(200) + '\n' + 'B'.repeat(50)));

    expect(second).toBeUndefined();
  });

  it('emits only new buffered content in the next segment after the interval', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 120, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithText('A'.repeat(200)));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    now = 121_000;
    const second = segmenter.update(stateWithText('A'.repeat(200) + '\nNEW-ONLY-CONTENT'));

    expect(second?.index).toBe(2);
    expect(second?.content).toContain('NEW-ONLY-CONTENT');
    expect(second?.content).not.toContain('A'.repeat(80));
  });

  it('terminal update targets the current visible segment and does not emit unsent tail content', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 120, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithText('A'.repeat(200)));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    now = 60_000;
    segmenter.update(stateWithText('A'.repeat(200) + '\nUNSENT-TAIL'));
    const terminal = segmenter.terminal({ ...stateWithText('A'.repeat(200) + '\nUNSENT-TAIL'), terminal: 'done', footer: null });

    expect(terminal?.index).toBe(1);
    expect(terminal?.terminal).toBe(true);
    expect(terminal?.content).toContain('✅ 已完成');
    expect(terminal?.content).not.toContain('UNSENT-TAIL');
  });
});

function stateWithText(text: string): RunState {
  return {
    blocks: [{ kind: 'text', content: text, streaming: false }],
    reasoning: { content: '', active: false },
    footer: 'streaming',
    terminal: 'running',
  };
}
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm exec vitest -- run tests/unit/card/progress-segments.test.ts
```

Expected: fails because `src/card/progress-segments.ts` does not exist.

- [ ] **Step 3: Implement minimal segmenter**

Create `src/card/progress-segments.ts` with:

```ts
import type { RunState } from './run-state';
import { renderText } from './text-renderer';

export const PROGRESS_SEGMENT_MAX_CHARS = 10_000;
export const PROGRESS_SEGMENT_MIN_INTERVAL_MS = 120_000;
const HEADER_RESERVE = 80;

export interface ProgressSegment {
  index: number;
  content: string;
  terminal: boolean;
}

export class ProgressSegmenter {
  private readonly maxChars: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private emittedChars = 0;
  private activeIndex = 1;
  private lastSentAt = 0;
  private activeContent = '';
  private activeFull = false;

  constructor(opts: { maxChars?: number; minIntervalMs?: number; now?: () => number } = {}) {
    this.maxChars = opts.maxChars ?? PROGRESS_SEGMENT_MAX_CHARS;
    this.minIntervalMs = opts.minIntervalMs ?? PROGRESS_SEGMENT_MIN_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
  }

  update(state: RunState): ProgressSegment | undefined {
    const full = renderText({ ...state, terminal: 'running' }).trim();
    const delta = full.slice(this.emittedChars);
    if (!delta) return undefined;

    if (this.activeFull) {
      if (this.now() - this.lastSentAt < this.minIntervalMs) return undefined;
      this.activeIndex += 1;
      this.activeContent = '';
      this.activeFull = false;
    }

    const header = this.header(state, false);
    const bodyBudget = Math.max(0, this.maxChars - header.length - HEADER_RESERVE);
    const available = Math.max(0, bodyBudget - this.activeContent.length);
    if (available <= 0) {
      this.activeFull = true;
      return undefined;
    }

    const chunk = delta.slice(0, available);
    this.activeContent += chunk;
    this.emittedChars += chunk.length;
    if (chunk.length < delta.length || this.activeContent.length >= bodyBudget) {
      this.activeFull = true;
    }

    return this.segment(state, false);
  }

  markSent(_segment: ProgressSegment): void {
    this.lastSentAt = this.now();
  }

  terminal(state: RunState): ProgressSegment | undefined {
    if (!this.activeContent && this.emittedChars === 0) return undefined;
    return this.segment(state, true);
  }

  private segment(state: RunState, terminal: boolean): ProgressSegment {
    const content = `${this.header(state, terminal)}\n\n${this.activeContent}`.slice(0, this.maxChars);
    return { index: this.activeIndex, content, terminal };
  }

  private header(state: RunState, terminal: boolean): string {
    const status = terminal ? terminalStatus(state) : runningStatus(state);
    const elapsed = state.durationMs !== undefined ? `\n已用时：${formatDuration(state.durationMs)}` : '';
    return `进展更新 #${this.activeIndex}\n状态：${status}${elapsed}`;
  }
}

function runningStatus(state: RunState): string {
  if (state.footer === 'tool_running') return '正在调用工具';
  if (state.footer === 'streaming') return '正在输出';
  return '思考中';
}

function terminalStatus(state: RunState): string {
  if (state.terminal === 'done') return '✅ 已完成';
  if (state.terminal === 'interrupted') return '⏹ 已中断';
  if (state.terminal === 'idle_timeout') return '⏱ 已超时';
  if (state.terminal === 'error') return '⚠️ 失败';
  return runningStatus(state);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
}
```

- [ ] **Step 4: Run segmenter tests to verify GREEN**

Run:

```bash
npm exec vitest -- run tests/unit/card/progress-segments.test.ts
```

Expected: all tests pass.

---

### Task 2: Wire markdown mode through segmented progress cards

**Files:**
- Modify: `src/bot/channel.ts`
- Test: `tests/unit/card/progress-segments.test.ts`

**Interfaces:**
- Consumes: `ProgressSegmenter.update`, `ProgressSegmenter.markSent`, `ProgressSegmenter.terminal`.
- Produces: markdown reply mode no longer calls `channel.stream` with full accumulated `renderText(state)` during long process updates.

- [ ] **Step 1: Import segmenter**

In `src/bot/channel.ts`, add:

```ts
import { ProgressSegmenter, type ProgressSegment } from '../card/progress-segments';
```

- [ ] **Step 2: Add segmented card send/update helper types**

Near `sendFinalReply`, add:

```ts
interface ProgressCardHandle {
  messageId: string;
  content: string;
}

async function sendProgressSegment(
  channel: LarkChannel,
  chatId: string,
  segment: ProgressSegment,
  sendOpts: { replyTo: string; replyInThread?: boolean },
): Promise<ProgressCardHandle> {
  const result = await channel.send(chatId, { markdown: segment.content }, sendOpts);
  return { messageId: result.messageId ?? '', content: segment.content };
}

async function updateProgressSegment(
  channel: LarkChannel,
  handle: ProgressCardHandle,
  segment: ProgressSegment,
): Promise<void> {
  if (!handle.messageId) return;
  await channel.updateCard(handle.messageId, { markdown: segment.content } as never);
  handle.content = segment.content;
}
```

If `LarkChannel` type does not expose `updateCard`, use a narrow local type:

```ts
type ProgressUpdateChannel = LarkChannel & { updateCard(messageId: string, card: unknown): Promise<void> };
```

and cast only inside `updateProgressSegment`.

- [ ] **Step 3: Replace markdown mode streaming body**

In the `replyMode === 'markdown'` branch in `runAgentBatch`, replace the current `channel.stream(... markdown.setContent(...))` orchestration with this structure:

```ts
      const segmenter = new ProgressSegmenter();
      const handles = new Map<number, ProgressCardHandle>();
      const renderDone = processAgentStream(
        handle,
        eventStream,
        scope,
        idleTimeoutMs,
        recordSession,
        async (state) => {
          const segment = segmenter.update(filterForPrefs(state));
          if (!segment) return;
          const existing = handles.get(segment.index);
          if (existing) {
            await updateProgressSegment(channel, existing, segment).catch((err) =>
              log.warn('stream', 'progress-update-failed', {
                scope,
                err: err instanceof Error ? err.message : String(err),
              }),
            );
          } else {
            const sent = await sendProgressSegment(channel, chatId, segment, sendOpts);
            handles.set(segment.index, sent);
            segmenter.markSent(segment);
          }
        },
      );
      const finalState = await renderDone;
      const terminal = segmenter.terminal(filterForPrefs(finalState));
      if (terminal) {
        const existing = handles.get(terminal.index);
        if (existing) {
          await updateProgressSegment(channel, existing, terminal).catch((err) =>
            log.warn('stream', 'progress-terminal-update-failed', {
              scope,
              err: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }
      if (finalState.terminal !== 'done' || (finalState.durationMs ?? 0) >= FINAL_SUMMARY_NOTIFY_AFTER_MS) {
        await sendFinalAnswerFallback({
          channel,
          chatId,
          scope,
          state: finalAnswerOnlyState(finalState),
          replyMode,
          sendOpts,
          reason: finalState.terminal === 'done' ? 'markdown-stream-complete' : 'markdown-stream-terminal',
        });
      }
```

- [ ] **Step 4: Run typecheck to surface channel type issues**

Run:

```bash
npm exec tsc -- --noEmit
```

Expected: if type errors mention `updateCard`, adjust helper with the narrow cast described in Step 2.

---

### Task 3: Wire card mode through segmented progress cards

**Files:**
- Modify: `src/bot/channel.ts`
- Test: focused tests from prior tasks

**Interfaces:**
- Consumes: same `ProgressSegmenter` and progress helpers from Task 2.
- Produces: card mode uses segmented progress content instead of unbounded `channel.stream` updates.

- [ ] **Step 1: Replace card mode streaming orchestration**

In the `replyMode === 'card'` branch in `runAgentBatch`, replace the `channel.stream({ card: { initial, producer }})` orchestration with the same segmented send/update pattern as markdown mode, but render `segment.content` as a card:

```ts
function progressSegmentCard(segment: ProgressSegment): object {
  return {
    schema: '2.0',
    config: {
      streaming_mode: false,
      summary: { content: segment.terminal ? '已完成' : `进展更新 #${segment.index}` },
    },
    body: { elements: [{ tag: 'markdown', content: segment.content }] },
  };
}
```

Then use card content helpers:

```ts
async function sendProgressCardSegment(
  channel: LarkChannel,
  chatId: string,
  segment: ProgressSegment,
  sendOpts: { replyTo: string; replyInThread?: boolean },
): Promise<ProgressCardHandle> {
  const result = await channel.send(chatId, { card: progressSegmentCard(segment) }, sendOpts);
  return { messageId: result.messageId ?? '', content: segment.content };
}

async function updateProgressCardSegment(
  channel: LarkChannel,
  handle: ProgressCardHandle,
  segment: ProgressSegment,
): Promise<void> {
  if (!handle.messageId) return;
  await channel.updateCard(handle.messageId, progressSegmentCard(segment));
  handle.content = segment.content;
}
```

- [ ] **Step 2: Keep final summary policy identical to markdown mode**

After terminal progress update, keep:

```ts
      if (finalState.terminal !== 'done' || (finalState.durationMs ?? 0) >= FINAL_SUMMARY_NOTIFY_AFTER_MS) {
        await sendFinalAnswerFallback({
          channel,
          chatId,
          scope,
          state: finalAnswerOnlyState(finalState),
          replyMode,
          sendOpts,
          reason: finalState.terminal === 'done' ? 'card-stream-complete' : 'card-stream-terminal',
        });
      }
```

- [ ] **Step 3: Run focused unit tests and typecheck**

Run:

```bash
npm exec vitest -- run tests/unit/card/progress-segments.test.ts tests/unit/bot/final-answer-fallback.test.ts tests/unit/card/run-renderer.snapshot.test.ts
npm exec tsc -- --noEmit
```

Expected: tests pass and typecheck exits 0.

---

### Task 4: Add regression coverage for repeated full-state updates

**Files:**
- Create: `tests/unit/card/progress-segments-regression.test.ts`

**Interfaces:**
- Consumes: `ProgressSegmenter`.
- Produces: regression proving repeated full-state inputs near 30k do not produce duplicate 29.5k segments.

- [ ] **Step 1: Write regression test**

Create `tests/unit/card/progress-segments-regression.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProgressSegmenter } from '../../../src/card/progress-segments.js';
import type { RunState } from '../../../src/card/run-state.js';

describe('ProgressSegmenter duplicate-card regression', () => {
  it('does not emit repeated large duplicate segments for repeated full-state updates', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 10_000, minIntervalMs: 120_000, now: () => now });
    const emitted: string[] = [];

    for (let i = 0; i < 30; i++) {
      const state = stateWithText(Array.from({ length: i + 1 }, (_, n) => `tool-line-${n}-${'x'.repeat(500)}`).join('\n'));
      const segment = segmenter.update(state);
      if (segment) {
        emitted.push(segment.content);
        segmenter.markSent(segment);
      }
      now += 30_000;
    }

    expect(emitted.length).toBeLessThan(10);
    expect(new Set(emitted).size).toBe(emitted.length);
    for (const content of emitted) {
      expect(content.length).toBeLessThanOrEqual(10_000);
    }
  });
});

function stateWithText(text: string): RunState {
  return {
    blocks: [{ kind: 'text', content: text, streaming: false }],
    reasoning: { content: '', active: false },
    footer: 'tool_running',
    terminal: 'running',
  };
}
```

- [ ] **Step 2: Run regression test**

Run:

```bash
npm exec vitest -- run tests/unit/card/progress-segments-regression.test.ts
```

Expected: test passes.

---

### Task 5: Verify and report

**Files:**
- All modified files.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified implementation ready for commit if user requests.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm exec vitest -- run tests/unit/card/progress-segments.test.ts tests/unit/card/progress-segments-regression.test.ts tests/unit/bot/final-answer-fallback.test.ts tests/unit/card/run-renderer.snapshot.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm exec tsc -- --noEmit
```

Expected: exits 0.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git diff --stat && git diff -- src/card/progress-segments.ts src/bot/channel.ts
```

Expected: diff shows segmented progress implementation and tests only.

- [ ] **Step 5: Report honestly**

Report focused tests, typecheck, build results. If full `npm test` still fails on the known unrelated preflight environment case, state that separately and do not claim full-suite green.

---

## Self-Review

- Spec coverage: segmentation by content is Task 1; 2-minute gate is Task 1; non-overlap is Task 1/4; terminal no tail process card is Task 1/2/3; final summary policy is Task 2/3; no agent-send suppression is preserved by only changing bridge progress rendering; CoT unchanged.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: `ProgressSegmenter`, `ProgressSegment`, `ProgressCardHandle`, and constants are consistently named.
