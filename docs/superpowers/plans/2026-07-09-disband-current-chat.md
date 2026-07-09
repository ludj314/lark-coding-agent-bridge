# Disband Current Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/disband` as a standalone bridge command that can preview or execute disbanding the current group chat and cleaning local bridge state without requiring users to type a chat id.

**Architecture:** Reuse command dispatch in `src/commands/index.ts`. `/disband` without `--yes` previews the destructive action; `/disband --yes` calls Feishu `DELETE /open-apis/im/v1/chats/:chat_id` through `channel.rawClient.request`/API path, then clears bridge local state keyed by the current `chatId` and `chatId:*`. Local cleanup helpers are added to `SessionStore`, `WorkspaceStore`, and `SessionCatalog` for prefix deletion.

**Tech Stack:** TypeScript, existing command handler framework, Lark raw API `DELETE /open-apis/im/v1/chats/:chat_id`, Vitest integration command tests.

## Global Constraints

- Command name is `/disband`.
- `/disband` previews only and tells the user to run `/disband --yes`.
- `/disband --yes` uses current `ctx.msg.chatId`; users never type chat id.
- Only group/topic chats are allowed; p2p is rejected.
- Must be admin-gated via existing admin command policy.
- If any active run exists for `chatId` or `chatId:*`, reject and ask user to stop it first.
- Call Feishu disband API before local cleanup; if API fails, local config remains unchanged.
- API: `DELETE /open-apis/im/v1/chats/:chat_id`; scope `im:chat` or `im:chat:delete`; bot token requires bot is group owner or creator with `im:chat:operate_as_owner`.
- After API success, clean local state for `chatId` and `chatId:*`: allowedChats, workspaces, sessions, session catalog, pending queue.
- Do not delete logs or media cache.

---

## Tasks

1. Add prefix cleanup helpers to state stores with unit tests.
2. Add `/disband` command preview and p2p rejection tests.
3. Add `/disband --yes` API call + local cleanup tests using fake channel rawClient.
4. Run focused tests, typecheck, build, commit, push, restart.
