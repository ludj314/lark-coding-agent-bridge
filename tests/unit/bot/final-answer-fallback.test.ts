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

  it('sends only the final text block when fallback is requested', async () => {
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
      { markdown: '最终结论：任务已完成。' },
      { replyTo: 'om_input' },
    );
  });

  it('does not send an empty fallback when the agent produced no final text', async () => {
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

    expect(send).not.toHaveBeenCalled();
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
