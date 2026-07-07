import { describe, expect, it } from 'vitest';
import { ProgressSegmenter } from '../../../src/card/progress-segments.js';
import type { RunState } from '../../../src/card/run-state.js';

describe('ProgressSegmenter duplicate-card regression', () => {
  it('does not emit repeated large duplicate segments for repeated full-state updates', () => {
    let now = 0;
    const segmenter = new ProgressSegmenter({ maxChars: 10_000, minIntervalMs: 120_000, now: () => now });
    const created = new Map<number, string>();

    for (let i = 0; i < 30; i++) {
      const state = stateWithText(Array.from({ length: i + 1 }, (_, n) => `tool-line-${n}-${'x'.repeat(500)}`).join('\n'));
      const segment = segmenter.update(state);
      if (segment) {
        if (!created.has(segment.index)) {
          created.set(segment.index, segment.content);
          segmenter.markSent(segment);
        }
      }
      now += 30_000;
    }

    const contents = [...created.values()];
    expect(contents.length).toBeLessThan(10);
    expect(new Set(contents).size).toBe(contents.length);
    for (const content of contents) {
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
