# Stream Final Summary Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make stream completion UX concise for short successful runs while guaranteeing a separate final summary when streaming fails or a run lasts at least 60 seconds, and make the original stream card's terminal state explicit.

**Architecture:** Keep the existing `processAgentStream` and `awaitRenderAwareStream` split. `processAgentStream` will return terminal state plus run duration metadata; `awaitRenderAwareStream` will decide whether a separate final summary is needed based on stream health and duration. Rendering functions will show an explicit terminal line for done/error/interrupted/timeout states so the original stream card does not end with an ambiguous running footer.

**Tech Stack:** TypeScript, Vitest, existing `RunState`/`renderCard`/`renderText` helpers, `@larksuite/channel` stream API.

## Global Constraints

- Do not add a user-facing config option in this change; use a hard-coded 60,000 ms threshold.
- Use agent run duration: from `processAgentStream` start to terminal state.
- Stream failure or fallback path always sends the separate final summary.
- Stream success sends the separate final summary only when run duration is at least 60,000 ms.
- The original stream card/text must show an explicit terminal state and must not rely on `🧰 正在调用工具…` as the final visible state.
- Preserve existing topic reply options (`replyTo`, `replyInThread`) and final-answer-only summary behavior.

---

## File Structure

- Modify `src/card/run-state.ts`
  - Add optional `durationMs?: number` to `RunState` so stream policy and renderers can make duration-based decisions without changing call signatures everywhere.
- Modify `src/card/run-renderer.ts`
  - Render explicit terminal notes for done/error/interrupted/timeout in card mode, including done even when body elements already exist.
- Modify `src/card/text-renderer.ts`
  - Render explicit `✅ 已完成` in text/markdown stream mode when terminal is `done`.
- Modify `src/bot/channel.ts`
  - Add `FINAL_SUMMARY_NOTIFY_AFTER_MS = 60_000`.
  - Set `durationMs` on the final state returned by `processAgentStream`.
  - Change `awaitRenderAwareStream` to return `finalNotificationNeeded` based on fallback or duration threshold.
  - Keep separate summary sending for fallback paths, but suppress it on short successful streams.
- Modify `tests/unit/card/run-renderer.snapshot.test.ts`
  - Add/update assertions for explicit terminal text in card and markdown rendering.
- Modify `tests/unit/bot/final-answer-fallback.test.ts`
  - Update tests for short success, long success, and stream failure final-summary policy.

---

### Task 1: Add duration-aware final-summary policy

**Files:**
- Modify: `src/card/run-state.ts`
- Modify: `src/bot/channel.ts`
- Test: `tests/unit/bot/final-answer-fallback.test.ts`

**Interfaces:**
- Consumes: `RunState` from `src/card/run-state.ts`.
- Produces: `RunState.durationMs?: number`; `awaitRenderAwareStream(...): Promise<{ state: RunState; fallbackUsed: boolean; finalNotificationNeeded: boolean }>` where `finalNotificationNeeded` is true for fallback or duration `>= 60_000`.

- [ ] **Step 1: Write failing tests for short successful streams**

In `tests/unit/bot/final-answer-fallback.test.ts`, replace the current normal-success test with this exact test:

```ts
  it('does not request a final notification for short healthy streams', async () => {
    const state = finalState('最终结论：任务已完成。', 59_999);

    const result = await awaitRenderAwareStream({
      mode: 'markdown',
      streamDone: Promise.resolve(),
      renderDone: Promise.resolve(state),
      producerStarted: () => true,
      fallback: async () => {
        throw new Error('fallback should not run on a healthy stream');
      },
    });

    expect(result).toEqual({ state, fallbackUsed: false, finalNotificationNeeded: false });
  });
```

- [ ] **Step 2: Add failing test for long successful streams**

In the same describe block, add:

```ts
  it('requests a final notification for healthy streams lasting at least one minute', async () => {
    const state = finalState('最终结论：任务已完成。', 60_000);

    const result = await awaitRenderAwareStream({
      mode: 'markdown',
      streamDone: Promise.resolve(),
      renderDone: Promise.resolve(state),
      producerStarted: () => true,
      fallback: async () => {
        throw new Error('fallback should not run on a healthy stream');
      },
    });

    expect(result).toEqual({ state, fallbackUsed: false, finalNotificationNeeded: true });
  });
```

- [ ] **Step 3: Update fallback test expectation**

Ensure the existing producer-not-started fallback test expects fallback to still request a final notification:

```ts
    expect(result).toEqual({ state, fallbackUsed: true, finalNotificationNeeded: true });
```

- [ ] **Step 4: Update test helper**

Change the helper at the bottom of `tests/unit/bot/final-answer-fallback.test.ts` to:

```ts
function finalState(content: string, durationMs = 0): RunState {
  return {
    blocks: [{ kind: 'text', content, streaming: false }],
    reasoning: { content: '', active: false },
    footer: null,
    terminal: 'done',
    durationMs,
  };
}
```

- [ ] **Step 5: Run tests to verify RED**

Run:

```bash
npm exec vitest -- run tests/unit/bot/final-answer-fallback.test.ts
```

Expected: at least the short healthy stream test fails because current code returns `finalNotificationNeeded: true`.

- [ ] **Step 6: Add duration to RunState**

In `src/card/run-state.ts`, change `RunState` to include:

```ts
  /** Elapsed time from agent stream processing start to terminal state. */
  durationMs?: number;
```

- [ ] **Step 7: Define threshold constant**

Near the existing constants in `src/bot/channel.ts`, add:

```ts
const FINAL_SUMMARY_NOTIFY_AFTER_MS = 60_000;
```

- [ ] **Step 8: Set final duration in processAgentStream**

In `processAgentStream`, replace the final logging block:

```ts
  log.info('card', 'final', { scope, terminal: state.terminal, interrupted: handle.interrupted });
  reportMetric('run_e2e_ms', Date.now() - runStart, { terminal: state.terminal });
```

with:

```ts
  const durationMs = Date.now() - runStart;
  state = { ...state, durationMs };
  log.info('card', 'final', {
    scope,
    terminal: state.terminal,
    interrupted: handle.interrupted,
    durationMs,
  });
  reportMetric('run_e2e_ms', durationMs, { terminal: state.terminal });
```

- [ ] **Step 9: Implement duration policy in awaitRenderAwareStream**

In `src/bot/channel.ts`, add this helper near `awaitRenderAwareStream`:

```ts
function shouldSendLongRunFinalNotification(state: RunState): boolean {
  return (state.durationMs ?? 0) >= FINAL_SUMMARY_NOTIFY_AFTER_MS;
}
```

Then change all fallback return branches in `awaitRenderAwareStream` to return `finalNotificationNeeded: true`, for example:

```ts
return { state: rendered.state, fallbackUsed: true, finalNotificationNeeded: true };
```

Change healthy stream-success branches to use the helper:

```ts
return {
  state: rendered.state,
  fallbackUsed: false,
  finalNotificationNeeded: shouldSendLongRunFinalNotification(rendered.state),
};
```

and:

```ts
return {
  state: first.state,
  fallbackUsed: false,
  finalNotificationNeeded: shouldSendLongRunFinalNotification(first.state),
};
```

- [ ] **Step 10: Run focused tests to verify GREEN**

Run:

```bash
npm exec vitest -- run tests/unit/bot/final-answer-fallback.test.ts
```

Expected: all tests in the file pass.

---

### Task 2: Make terminal state explicit in original stream output

**Files:**
- Modify: `src/card/run-renderer.ts`
- Modify: `src/card/text-renderer.ts`
- Test: `tests/unit/card/run-renderer.snapshot.test.ts`

**Interfaces:**
- Consumes: `RunState.terminal`, `RunState.errorMsg`, `RunState.idleTimeoutMinutes`.
- Produces: card and markdown outputs that include explicit terminal text: `✅ 已完成`, `⚠️ agent 失败：...`, `⏹ 已被中断`, `⏱ N 分钟无响应,已自动终止`.

- [ ] **Step 1: Add explicit assertions for card terminal done**

In `tests/unit/card/run-renderer.snapshot.test.ts`, add after the existing terminal-state test:

```ts
  it('shows an explicit done marker when a completed card has prior content', () => {
    const card = JSON.stringify(renderCard(stateFrom([
      { type: 'tool_use', id: 'tool-1', name: 'TaskCreate', input: { subject: 'x' } },
      { type: 'tool_result', id: 'tool-1', output: 'ok', isError: false },
      { type: 'done', terminationReason: 'normal' },
    ])));

    expect(card).toContain('✅ 已完成');
    expect(card).not.toContain('正在调用工具');
  });
```

- [ ] **Step 2: Add explicit assertion for markdown terminal done**

In the same file, add:

```ts
  it('shows an explicit done marker in markdown text mode', () => {
    const text = renderText(stateFrom([
      { type: 'text', delta: 'Final answer' },
      { type: 'done', terminationReason: 'normal' },
    ]));

    expect(text).toContain('Final answer');
    expect(text).toContain('✅ 已完成');
    expect(text).not.toContain('正在调用工具');
  });
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
npm exec vitest -- run tests/unit/card/run-renderer.snapshot.test.ts
```

Expected: the new tests fail because `✅ 已完成` is not rendered in completed states with content.

- [ ] **Step 4: Update card terminal rendering**

In `src/card/run-renderer.ts`, replace the terminal note block:

```ts
  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    elements.push(noteMd(`_⏱ ${mins} 分钟无响应,已自动终止_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ agent 失败：${state.errorMsg}`));
  } else if (state.terminal === 'done' && elements.length === 0) {
    elements.push(noteMd('_（未返回内容）_'));
  }
```

with:

```ts
  if (state.terminal === 'interrupted') {
    elements.push(noteMd('_⏹ 已被中断_'));
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    elements.push(noteMd(`_⏱ ${mins} 分钟无响应,已自动终止_`));
  } else if (state.terminal === 'error' && state.errorMsg) {
    elements.push(noteMd(`⚠️ agent 失败：${state.errorMsg}`));
  } else if (state.terminal === 'done') {
    elements.push(noteMd(elements.length === 0 ? '✅ 已完成（未返回内容）' : '✅ 已完成'));
  }
```

- [ ] **Step 5: Update markdown terminal rendering**

In `src/card/text-renderer.ts`, replace the terminal block:

```ts
  if (state.terminal === 'interrupted') {
    parts.push('_⏹ 已被中断_');
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    parts.push(`_⏱ ${mins} 分钟无响应,已自动终止_`);
  } else if (state.terminal === 'error' && state.errorMsg) {
    parts.push(`⚠️ agent 失败:${state.errorMsg}`);
  } else if (state.terminal === 'running' && state.footer) {
    parts.push(footerLine(state.footer));
  }
```

with:

```ts
  if (state.terminal === 'interrupted') {
    parts.push('_⏹ 已被中断_');
  } else if (state.terminal === 'idle_timeout') {
    const mins = state.idleTimeoutMinutes ?? 0;
    parts.push(`_⏱ ${mins} 分钟无响应,已自动终止_`);
  } else if (state.terminal === 'error' && state.errorMsg) {
    parts.push(`⚠️ agent 失败:${state.errorMsg}`);
  } else if (state.terminal === 'done') {
    parts.push('✅ 已完成');
  } else if (state.terminal === 'running' && state.footer) {
    parts.push(footerLine(state.footer));
  }
```

- [ ] **Step 6: Run focused renderer tests**

Run:

```bash
npm exec vitest -- run tests/unit/card/run-renderer.snapshot.test.ts
```

Expected: tests pass or snapshots fail only because `✅ 已完成` was intentionally added.

- [ ] **Step 7: Update snapshots if needed**

If Vitest reports snapshot mismatches from the intentional terminal marker, run:

```bash
npm exec vitest -- run tests/unit/card/run-renderer.snapshot.test.ts -u
```

Expected: snapshot file updates only add the explicit terminal marker.

---

### Task 3: Verify integrated stream behavior

**Files:**
- Test: `tests/unit/bot/final-answer-fallback.test.ts`
- Test: `tests/unit/card/run-renderer.snapshot.test.ts`
- Optional inspect: `src/bot/channel.ts`

**Interfaces:**
- Consumes: Task 1 `finalNotificationNeeded` behavior and Task 2 terminal renderer behavior.
- Produces: verified working tree ready for review.

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
npm exec vitest -- run tests/unit/bot/final-answer-fallback.test.ts tests/unit/card/run-renderer.snapshot.test.ts
```

Expected: both files pass.

- [ ] **Step 2: Run TypeScript typecheck**

Run:

```bash
npm exec tsc -- --noEmit
```

Expected: command exits 0 with no output.

- [ ] **Step 3: Inspect diff**

Run:

```bash
git diff -- src/bot/channel.ts src/card/run-state.ts src/card/run-renderer.ts src/card/text-renderer.ts tests/unit/bot/final-answer-fallback.test.ts tests/unit/card/run-renderer.snapshot.test.ts
```

Expected: diff only contains the duration threshold, summary policy, explicit terminal markers, and associated tests/snapshots.

- [ ] **Step 4: Do not commit unless requested**

The user has not requested a commit. Leave changes in the working tree and report the verification commands and results.

---

## Self-Review

- Spec coverage: Task 1 covers stream-failure vs duration-gated separate summary; Task 2 covers explicit terminal state in original stream output; Task 3 covers verification.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `durationMs?: number` is added to `RunState`; `awaitRenderAwareStream` keeps the existing return shape plus `finalNotificationNeeded`, already consumed by `runAgentBatch`.
