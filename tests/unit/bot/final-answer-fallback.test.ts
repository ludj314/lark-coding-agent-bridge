import { describe, expect, it, vi } from 'vitest';
import { awaitRenderAwareStream, sendFinalAnswerFallback } from '../../../src/bot/channel.js';
import type { RunState } from '../../../src/card/run-state.js';

describe('final answer fallback', () => {
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

  it('requests fallback when the agent finishes before the stream producer starts', async () => {
    const state = finalState('最终结论：任务已完成。');
    const fallback = vi.fn().mockResolvedValue(undefined);

    const result = await awaitRenderAwareStream({
      mode: 'markdown',
      streamDone: new Promise(() => undefined),
      renderDone: Promise.resolve(state),
      producerStarted: () => false,
      fallback,
    });

    expect(result).toEqual({ state, fallbackUsed: true, finalNotificationNeeded: true });
    expect(fallback).toHaveBeenCalledWith(state);
  });

  it('sends a short completion notice for successful final fallback', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'om_final' });
    const state: RunState = {
      blocks: [
        { kind: 'tool', tool: { id: 'tool-1', name: 'Bash', input: { command: 'pwd' }, status: 'done' } },
        { kind: 'text', content: '最终结论：任务已完成。', streaming: false },
      ],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'done',
    };

    await sendFinalAnswerFallback({
      channel: { send } as never,
      chatId: 'oc_chat',
      scope: 'oc_chat',
      state,
      replyMode: 'markdown',
      sendOpts: { replyTo: 'om_input' },
      reason: 'markdown-stream-terminal',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'oc_chat',
      { markdown: '✅ 已完成，详情请查看前面的进展消息。' },
      { replyTo: 'om_input' },
    );
  });

  it('truncates long non-success final summaries by preserving the tail', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'om_final' });
    const state = {
      ...finalState(`${'HEAD-ONLY-'.repeat(140)}\n${'middle-content-'.repeat(140)}\n尾部关键信息：Lark 文档 https://example.test/doc`),
      terminal: 'error' as const,
      errorMsg: 'failed',
    };

    await sendFinalAnswerFallback({
      channel: { send } as never,
      chatId: 'oc_chat',
      scope: 'oc_chat',
      state,
      replyMode: 'markdown',
      sendOpts: { replyTo: 'om_input' },
      reason: 'markdown-stream-terminal',
    });

    const markdown = send.mock.calls[0]?.[1]?.markdown as string;
    expect(send).toHaveBeenCalledTimes(1);
    expect(markdown.length).toBeLessThanOrEqual(1000);
    expect(markdown).toContain('最终总结已截断');
    expect(markdown).toContain('尾部关键信息');
    expect(markdown).not.toContain('HEAD-ONLY-HEAD-ONLY-HEAD-ONLY-');
  });

  it('sends a short completion fallback when the agent produced no final text', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: 'om_final' });
    const state: RunState = {
      blocks: [{ kind: 'tool', tool: { id: 'tool-1', name: 'Bash', input: {}, status: 'done' } }],
      reasoning: { content: '', active: false },
      footer: null,
      terminal: 'done',
    };

    await sendFinalAnswerFallback({
      channel: { send } as never,
      chatId: 'oc_chat',
      scope: 'oc_chat',
      state,
      replyMode: 'markdown',
      sendOpts: { replyTo: 'om_input' },
      reason: 'markdown-stream-terminal',
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'oc_chat',
      { markdown: '✅ 已完成，详情请查看前面的进展消息。' },
      { replyTo: 'om_input' },
    );
  });
});

function finalState(content: string, durationMs = 0): RunState {
  return {
    blocks: [{ kind: 'text', content, streaming: false }],
    reasoning: { content: '', active: false },
    footer: null,
    terminal: 'done',
    durationMs,
  };
}
