import { describe, expect, it } from 'vitest';
import { ProgressSegmenter } from '../../../src/card/progress-segments.js';
import type { RunState } from '../../../src/card/run-state.js';

describe('ProgressSegmenter', () => {
  it('emits the first card immediately regardless of the next-card threshold', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 10_000, nextSegmentMinChars: 500, now: () => 0 });
    const first = segmenter.update(stateWithText('short first reply'));

    expect(first?.index).toBe(1);
    expect(first?.content).toContain('short first reply');
  });

  it('uses a 10000-character default soft cap', () => {
    const segmenter = new ProgressSegmenter({ nextSegmentMinChars: 500, now: () => 0 });
    const text = `${'A'.repeat(9_500)}.\n${'B'.repeat(400)}`;
    const first = segmenter.update(stateWithText(text));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    const second = segmenter.update(stateWithText(`${text}${'B'.repeat(100)}`));

    expect(second?.index).toBe(1);
  });

  it('allows one progress segment to exceed the soft cap until a readable boundary appears', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 120, nextSegmentMinChars: 50, now: () => 0 });
    const first = segmenter.update(stateWithText('A'.repeat(200)));

    expect(first?.content.length).toBeGreaterThan(120);
    expect(first?.content).toContain('进展更新 #1');
  });

  it('starts the next card after a completed segment has at least the configured minimum tail', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 120, nextSegmentMinChars: 20, now: () => 0 });
    const firstText = `${'A'.repeat(50)}.\n${'B'.repeat(10)}`;
    const first = segmenter.update(stateWithText(firstText));
    expect(first).toBeDefined();
    expect(first?.index).toBe(1);
    expect(first?.content).toContain('A'.repeat(50));
    expect(first?.content).not.toContain('B'.repeat(10));
    segmenter.markSent(first!);

    expect(segmenter.update(stateWithText(`${firstText}${'B'.repeat(8)}`))).toBeUndefined();

    const second = segmenter.update(stateWithText(`${firstText}${'B'.repeat(9)}`));

    expect(second?.index).toBe(2);
    expect(second?.content).toContain('B'.repeat(19));
    expect(second?.content).not.toContain('A'.repeat(40));
  });

  it('terminal drain emits a short remaining tail without waiting for the minimum', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 120, nextSegmentMinChars: 50, now: () => 0 });
    const text = `${'A'.repeat(50)}.\nshort tail`;
    const first = segmenter.update(stateWithText(text));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    const terminal = segmenter.terminalSegments({ ...stateWithText(text), terminal: 'done', footer: null });

    expect(terminal.map((segment) => segment.index)).toEqual([1, 2]);
    const [completedSegment, tailSegment] = terminal;
    expect(completedSegment?.content).toContain('✅ 已完成');
    expect(tailSegment?.content).toContain('short tail');
  });

  it('keeps an unfinished sentence on the same card past the soft limit', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 120, nextSegmentMinChars: 20, now: () => 0 });
    const first = segmenter.update(stateWithText('A'.repeat(140)));

    expect(first?.index).toBe(1);
    expect(first?.content).toContain('A'.repeat(140));
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

  it('does not split markdown tables in the middle of a table row', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 160, nextSegmentMinChars: 20, now: () => 0 });
    const intro = `${'A'.repeat(60)}.\n`;
    const table = [
      '| Sheet 行 | 罗盘接口 | 指标 | 接口返回字段 / 路径 | 备注 |',
      '| -------- | -------- | -------- | -------- | -------- |',
      '| 6 | `/api/v:version/insights/seller/ttp/product/list` | GMV | **当前 v3：** `data.items[].stats_v3.total.gmv` | 当前 Product Analytics 使用 v3 |',
      '| 6 | 同上 | Items sold | **当前 v3：** `data.items[].stats_v3.total.items_sold` |  |',
    ].join('\n');
    const first = segmenter.update(stateWithText(`${intro}${table}`));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    const second = segmenter.update(stateWithText(`${intro}${table}\n${'tail'.repeat(10)}`));

    expect(second?.index).toBe(2);
    expect(first?.content).not.toContain('| Sheet 行 | 罗盘接口 | 指标 | 接口返回字段 / 路径 | 备注 |');
    expect(second?.content).toContain('| Sheet 行 | 罗盘接口 | 指标 | 接口返回字段 / 路径 | 备注 |');
    expect(second?.content).toContain('stats_v3.total.gmv` | 当前 Product Analytics 使用 v3 |');
  });

  it('terminal drain emits pending tail content without duplication', () => {
    const segmenter = new ProgressSegmenter({ maxChars: 120, nextSegmentMinChars: 50, now: () => 0 });
    const text = `${'A'.repeat(50)}.\nUNSENT-TAIL`;
    const first = segmenter.update(stateWithText(text));
    expect(first).toBeDefined();
    segmenter.markSent(first!);

    const terminal = segmenter.terminalSegments({ ...stateWithText(text), terminal: 'done', footer: null });

    expect(terminal.map((segment) => segment.index)).toEqual([1, 2]);
    const [completedSegment, tailSegment] = terminal;
    expect(completedSegment?.terminal).toBe(true);
    expect(completedSegment?.content).toContain('✅ 已完成');
    expect(completedSegment?.content).not.toContain('UNSENT-TAIL');
    expect(tailSegment?.content).toContain('UNSENT-TAIL');
    expect(tailSegment?.content).not.toContain('A'.repeat(40));
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
