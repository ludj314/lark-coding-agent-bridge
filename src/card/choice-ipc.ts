import { createServer, createConnection, type Server } from 'node:net';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LarkChannel } from '@larksuite/channel';
import type { ActiveRuns } from '../bot/active-runs';
import type { CallbackAuth } from './callback-auth';
import { choiceCard, type ChoiceOption } from './choice-card';

export interface ChoiceCardRequest {
  op: 'choice-card.send';
  chatId: string;
  scope: string;
  operatorOpenId: string;
  title: string;
  choices: ChoiceOption[];
  replyTo?: string;
  replyInThread?: boolean;
}

export type ChoiceCardResponse =
  | { ok: true; messageId: string }
  | { ok: false; error: string };

export interface ChoiceIpcDeps {
  socketPath: string;
  channel: LarkChannel;
  activeRuns: ActiveRuns;
  callbackAuth?: CallbackAuth;
  policyFingerprintForScope: (scope: string) => string | undefined;
}

export async function startChoiceIpcServer(deps: ChoiceIpcDeps): Promise<Server> {
  await mkdir(dirname(deps.socketPath), { recursive: true });
  await rm(deps.socketPath, { force: true }).catch(() => {});
  const server = createServer((socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.endsWith('\n')) {
        socket.pause();
        void handleRawRequest(deps, data).then((response) => {
          socket.end(`${JSON.stringify(response)}\n`);
        });
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  return server;
}

export function choiceIpcSocketPath(profileDir: string): string {
  return join(profileDir, 'choice-card.sock');
}

export async function sendChoiceCardOverIpc(
  socketPath: string,
  request: ChoiceCardRequest,
): Promise<ChoiceCardResponse> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    let data = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('error', (err) => resolve({ ok: false, error: err.message }));
    socket.on('end', () => {
      try {
        resolve(JSON.parse(data) as ChoiceCardResponse);
      } catch {
        resolve({ ok: false, error: 'invalid choice-card IPC response' });
      }
    });
  });
}

async function handleRawRequest(
  deps: ChoiceIpcDeps,
  raw: string,
): Promise<ChoiceCardResponse> {
  let request: ChoiceCardRequest;
  try {
    request = JSON.parse(raw) as ChoiceCardRequest;
  } catch {
    return { ok: false, error: 'invalid JSON request' };
  }
  if (request.op !== 'choice-card.send') return { ok: false, error: 'unknown op' };
  return sendChoiceCard(deps, request);
}

async function sendChoiceCard(
  deps: ChoiceIpcDeps,
  request: ChoiceCardRequest,
): Promise<ChoiceCardResponse> {
  if (!deps.callbackAuth) return { ok: false, error: 'callback auth unavailable' };
  const active = deps.activeRuns.get(request.scope);
  if (!active) return { ok: false, error: `no active run for scope ${request.scope}` };
  const policyFingerprint = deps.policyFingerprintForScope(request.scope);
  if (!policyFingerprint) return { ok: false, error: `no active policy for scope ${request.scope}` };
  if (request.choices.length < 1 || request.choices.length > 5) {
    return { ok: false, error: 'choices length must be 1..5' };
  }

  const card = choiceCard({
    title: request.title,
    choices: request.choices,
    action: 'agent_callback',
    sign: () =>
      deps.callbackAuth!.sign({
        runId: active.run.runId,
        scope: request.scope,
        chatId: request.chatId,
        operatorOpenId: request.operatorOpenId,
        action: 'agent_callback',
        policyFingerprint,
        ttlMs: 24 * 60 * 60 * 1000,
      }),
  });
  const result = await deps.channel.send(
    request.chatId,
    { card },
    request.replyTo
      ? { replyTo: request.replyTo, ...(request.replyInThread ? { replyInThread: true as const } : {}) }
      : undefined,
  );
  return { ok: true, messageId: result.messageId };
}
