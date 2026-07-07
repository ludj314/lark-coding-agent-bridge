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

function stateWithTool(status: 'running' | 'done'): RunState {
  return {
    blocks: [{ kind: 'tool', tool: { id: 'tool-1', name: 'Bash', input: { command: 'pwd' }, status } }],
    reasoning: { content: '', active: false },
    footer: status === 'running' ? 'tool_running' : null,
    terminal: 'running',
  };
}
