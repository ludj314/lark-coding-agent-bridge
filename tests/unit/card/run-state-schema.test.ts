import { describe, expect, it } from 'vitest';
import { initialState, reduce } from '../../../src/card/run-state';

describe('run state terminal event schema', () => {
  it('keeps the latest three useful thinking progress entries', () => {
    const state = [
      { type: 'thinking' as const, delta: '> ✅ **Read** — /repo/src/a.ts\n' },
      { type: 'thinking' as const, delta: '> 按 TDD 来：先改 progress segment 和 final fallback 的测试，让它们失败，再实现 compact summary 和统一完成通知。\n' },
      { type: 'thinking' as const, delta: '先改测试。\n' },
      { type: 'thinking' as const, delta: '> ✅ **TaskUpdate**\n' },
      { type: 'thinking' as const, delta: '先改测试。\n' },
      { type: 'thinking' as const, delta: '实现 compact summary。\n' },
      { type: 'thinking' as const, delta: '运行验证。\n' },
    ].reduce((state, event) => reduce(state, event), initialState);

    expect(state.progress.entries).toEqual([
      '先改测试。',
      '实现 compact summary。',
      '运行验证。',
    ]);
    expect(state.reasoning.content).toBe('');
    expect(state.footer).toBe('thinking');
  });

  it('extracts short text progress entries without treating long answers as progress', () => {
    const state = [
      { type: 'text' as const, delta: '我先确认当前 bridge 进程和 tmux 状态。' },
      { type: 'text' as const, delta: 'Bridge 已经在 tmux 里重新起来了；我再跑一次最小回归，确认新进度摘要行为仍通过。' },
      { type: 'text' as const, delta: '这是一大段很长的最终总结，包含很多细节，应该作为最终正文处理，不应该被提取到顶部当前进度里，因为用户只想看到最新三条短进度。'.repeat(3) },
    ].reduce((state, event) => reduce(state, event), initialState);

    expect(state.progress.entries).toEqual([
      '我先确认当前 bridge 进程和 tmux 状态。',
      'Bridge 已经在 tmux 里重新起来了；我再跑一次最小回归，确认新进度摘要行为仍通过。',
    ]);
  });

  it('ignores thinking chunks that only contain quoted tool lines', () => {
    const state = reduce(initialState, {
      type: 'thinking',
      delta: '> ✅ **Read** — /repo/src/a.ts\n> ⏳ **Bash** — pnpm test\n> ❌ **TaskUpdate**\n',
    });

    expect(state.progress.entries).toEqual([]);
    expect(state.reasoning.content).toBe('');
    expect(state.footer).toBe('thinking');
  });

  it('maps done termination reasons onto visible terminal states', () => {
    expect(reduce(initialState, { type: 'done', terminationReason: 'normal' }).terminal).toBe(
      'done',
    );
    expect(
      reduce(initialState, { type: 'done', terminationReason: 'interrupted' }).terminal,
    ).toBe('interrupted');
    expect(reduce(initialState, { type: 'done', terminationReason: 'timeout' }).terminal).toBe(
      'idle_timeout',
    );
  });

  it('maps error termination reasons onto visible terminal states', () => {
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'failed',
        terminationReason: 'failed',
      }).terminal,
    ).toBe('error');
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'stopped',
        terminationReason: 'interrupted',
      }).terminal,
    ).toBe('interrupted');
    expect(
      reduce(initialState, {
        type: 'error',
        message: 'timeout',
        terminationReason: 'timeout',
      }).terminal,
    ).toBe('idle_timeout');
  });
});
