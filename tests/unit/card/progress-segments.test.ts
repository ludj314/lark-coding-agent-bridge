import { describe, expect, it } from 'vitest';
import { ProgressSegmenter } from '../../../src/card/progress-segments.js';
import type { RunState, ToolStatus } from '../../../src/card/run-state.js';

describe('ProgressSegmenter', () => {
  it('renders compact tool summary without agent text or full tool history', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 1000, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithManyTools());

    expect(first?.content).toContain('进展更新 #1');
    expect(first?.content).toContain('工具概览');
    expect(first?.content).toContain('已完成：6');
    expect(first?.content).toContain('进行中：1');
    expect(first?.content).toContain('失败：1');
    expect(first?.content).toContain('最近动作');
    expect(first?.content).toContain('⏳ **Edit**');
    expect(first?.content).not.toContain('agent 自言自语');
    expect((first?.content.match(/Bash/g) ?? []).length).toBeLessThanOrEqual(4);
  });

  it('updates previously emitted tool status in the active segment', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 1000, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithTool('running'));
    expect(first?.content).toContain('⏳ **Bash**');
    segmenter.markSent(first!);

    const updated = segmenter.update(stateWithTool('done'));

    expect(updated?.index).toBe(1);
    expect(updated?.content).toContain('✅ **Bash**');
    expect(updated?.content).not.toContain('⏳ **Bash**');
  });

  it('terminal update shows completion without unsent agent text', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 1000, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithManyTools());
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    const terminal = segmenter.terminal({ ...stateWithManyTools(), terminal: 'done', footer: null });

    expect(terminal?.index).toBe(1);
    expect(terminal?.terminal).toBe(true);
    expect(terminal?.content).toContain('✅ 已完成');
    expect(terminal?.content).not.toContain('agent 自言自语');
  });
});

function stateWithTool(status: ToolStatus): RunState {
  return {
    blocks: [{ kind: 'tool', tool: { id: 'tool-1', name: 'Bash', input: { command: 'pwd' }, status } }],
    reasoning: { content: '', active: false },
    footer: status === 'running' ? 'tool_running' : null,
    terminal: 'running',
  };
}

function stateWithManyTools(): RunState {
  return {
    blocks: [
      { kind: 'text', content: 'agent 自言自语：我先查一下', streaming: false },
      ...Array.from({ length: 6 }, (_, index) => ({
        kind: 'tool' as const,
        tool: { id: `done-${index}`, name: 'Bash', input: { command: `cmd-${index}` }, status: 'done' as const },
      })),
      { kind: 'tool', tool: { id: 'err-1', name: 'Read', input: { file_path: '/missing' }, status: 'error' } },
      { kind: 'tool', tool: { id: 'run-1', name: 'Edit', input: { file_path: '/tmp/a' }, status: 'running' } },
    ],
    reasoning: { content: '', active: false },
    footer: 'tool_running',
    terminal: 'running',
  };
}
