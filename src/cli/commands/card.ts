import { resolveAppPaths } from '../../config/app-paths';
import { choiceIpcSocketPath, sendChoiceCardOverIpc, type ChoiceCardRequest } from '../../card/choice-ipc';

export interface CardSendOptions {
  profile?: string;
  chatId: string;
  scope: string;
  operatorOpenId: string;
  title: string;
  choice?: string[];
  replyTo?: string;
  replyInThread?: boolean;
}

export async function runCardSend(opts: CardSendOptions): Promise<void> {
  const choices = (opts.choice ?? []).map(parseChoice);
  const request: ChoiceCardRequest = {
    op: 'choice-card.send',
    chatId: opts.chatId,
    scope: opts.scope,
    operatorOpenId: opts.operatorOpenId,
    title: opts.title,
    choices,
    ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    ...(opts.replyInThread ? { replyInThread: true } : {}),
  };
  const paths = resolveAppPaths({ profile: opts.profile ?? process.env.LARK_CHANNEL_PROFILE });
  const response = await sendChoiceCardOverIpc(choiceIpcSocketPath(paths.profileDir), request);
  console.log(JSON.stringify(response));
  if (!response.ok) process.exitCode = 1;
}

function parseChoice(raw: string): { choice: string; label: string } {
  const idx = raw.indexOf(':');
  if (idx <= 0) throw new Error(`invalid --choice ${raw}; expected key:label`);
  return { choice: raw.slice(0, idx), label: raw.slice(idx + 1) };
}
