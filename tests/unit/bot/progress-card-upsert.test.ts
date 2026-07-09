import { describe, expect, it, vi } from 'vitest';
import { upsertProgressCard } from '../../../src/bot/channel.js';

describe('upsertProgressCard', () => {
  it('does not throw when sending a new progress card fails', async () => {
    const channel = {
      send: vi.fn(async () => {
        throw new Error('send failed');
      }),
      updateCard: vi.fn(),
    };
    const segmenter = { markSent: vi.fn() };
    const handles = new Map();

    await expect(upsertProgressCard({
      channel: channel as never,
      chatId: 'oc_chat',
      sendOpts: { replyTo: 'om_input' },
      handles,
      segmenter: segmenter as never,
      segment: { index: 1, content: 'progress', terminal: false },
      scope: 'oc_chat',
    })).resolves.toBeUndefined();

    expect(handles.size).toBe(0);
    expect(segmenter.markSent).not.toHaveBeenCalled();
  });
});
