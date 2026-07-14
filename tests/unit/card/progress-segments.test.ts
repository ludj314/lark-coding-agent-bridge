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

  it('updates previously emitted tool status in the active segment', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 500, minIntervalMs: 120_000, now: () => now });
    const first = segmenter.update(stateWithTool('running'));
    expect(first?.content).toContain('⏳ **Bash**');
    segmenter.markSent(first!);

    const updated = segmenter.update(stateWithTool('done'));

    expect(updated?.index).toBe(1);
    expect(updated?.content).toContain('✅ **Bash**');
    expect(updated?.content).not.toContain('⏳ **Bash**');
  });

  it('renders latest three tool commands on top and plain progress text below', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 1000, minIntervalMs: 120_000, now: () => 0 });
    const state: RunState = {
      blocks: [
        { kind: 'tool', tool: { id: 'tool-1', name: 'Read', input: { file_path: '/repo/a.ts' }, status: 'done' } },
        { kind: 'tool', tool: { id: 'tool-2', name: 'Bash', input: { command: 'rg -n "mergeProgressEntries" src/card/run-state.ts' }, status: 'done' } },
        { kind: 'tool', tool: { id: 'tool-3', name: 'Edit', input: { file_path: '/repo/src/card/progress-segments.ts' }, status: 'done' } },
        { kind: 'tool', tool: { id: 'tool-4', name: 'Bash', input: { command: 'npx vitest run tests/unit/card/progress-segments.test.ts' }, status: 'running' } },
        { kind: 'text', content: '我先按根因排查来。', streaming: false },
        { kind: 'text', content: '继续跑 progress segment 测试，看是否还需调整分段逻辑。', streaming: false },
      ],
      reasoning: { content: '', active: false },
      progress: { entries: ['不应该显示的 thinking 摘要。'] },
      footer: 'tool_running',
      terminal: 'running',
    };

    const segment = segmenter.update(state);

    expect(segment?.content).toContain('当前执行');
    expect(segment?.content).not.toContain('**Read**');
    expect(segment?.content).toContain('1. ✅ **Bash** — rg -n');
    expect(segment?.content).toContain('2. ✅ **Edit** — /repo/src/card/progress-segments.ts');
    expect(segment?.content).toContain('3. ⏳ **Bash** — npx vitest run tests/unit/card/progress-segments.test.ts');
    expect(segment?.content).not.toContain('不应该显示的 thinking 摘要。');
    expect(segment?.content).toContain('我先按根因排查来。');
    expect(segment?.content).toContain('继续跑 progress segment 测试');
    expect(segment?.content).not.toContain('> ✅ **Bash**');
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
    progress: { entries: [] },
    footer: 'streaming',
    terminal: 'running',
  };
}

function stateWithTool(status: 'running' | 'done'): RunState {
  return {
    blocks: [{ kind: 'tool', tool: { id: 'tool-1', name: 'Bash', input: { command: 'pwd' }, status } }],
    reasoning: { content: '', active: false },
    progress: { entries: [] },
    footer: status === 'running' ? 'tool_running' : null,
    terminal: 'running',
  };
}
