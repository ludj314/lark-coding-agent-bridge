import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import { CallbackAuth } from '../../../src/card/callback-auth.js';
import { CallbackNonceStore } from '../../../src/card/callback-store.js';
import { sendChoiceCardOverIpc, startChoiceIpcServer } from '../../../src/card/choice-ipc.js';
import { createFakeAgent } from '../../helpers/fake-agent.js';
import { createFakeChannel } from '../../helpers/fake-channel.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe('choice card IPC', () => {
  it('signs and sends callback choice cards through the running bridge process', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'choice-ipc-test-'));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const socketPath = join(dir, 'choice.sock');
    const channel = createFakeChannel();
    const activeRuns = new ActiveRuns();
    activeRuns.register('oc_chat', createFakeAgent().run({ runId: 'run-1', prompt: 'running' }));
    const nonceStore = new CallbackNonceStore(join(dir, 'nonces.json'));
    const auth = new CallbackAuth({
      keys: [{ version: 1, secret: 'secret' }],
      nonceStore,
      createNonce: () => 'nonce-1',
      now: () => 1000,
    });
    const server = await startChoiceIpcServer({
      socketPath,
      channel: channel as never,
      activeRuns,
      callbackAuth: auth,
      policyFingerprintForScope: () => 'fp-1',
    });
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));

    const response = await sendChoiceCardOverIpc(socketPath, {
      op: 'choice-card.send',
      chatId: 'oc_chat',
      scope: 'oc_chat',
      operatorOpenId: 'ou_user',
      title: '选一个',
      choices: [{ choice: 'a', label: '方案 A' }],
      replyTo: 'om_input',
    });

    expect(response).toMatchObject({ ok: true });
    const sent = channel.sent.at(-1);
    expect(sent?.options).toMatchObject({ replyTo: 'om_input' });
    const raw = JSON.stringify(sent?.content);
    expect(raw).toContain('__bridge_cb');
    expect(raw).toContain('bridge_cb.v1');
    expect(raw).toContain('方案 A');
  });
});
