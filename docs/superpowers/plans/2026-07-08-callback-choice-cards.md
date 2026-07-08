# Callback Choice Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bridge-side helper for agents to send real signed callback button cards and update clicked cards to a selected/disabled state.

**Architecture:** Add a local IPC server inside the running bridge process, with a `lark-channel-bridge card send` CLI client that connects to it. Keep callback signing and send/update operations in the bridge main process where `activeRuns`, `activePolicyFingerprints`, `callbackAuth`, and `channel` are available. Extend card dispatcher to update valid clicked cards after forwarding the click.

**Tech Stack:** TypeScript, Node `net` local socket, Commander CLI, existing `CallbackAuth`, `CallbackNonceStore`, `LarkChannel`, Vitest fake channels.

## Global Constraints

- Do not modify `lark-cli`.
- Helper only works while a run is active for the requested scope.
- Buttons must include `__bridge_cb: true` and real `bridge_token` signed by bridge main process.
- Valid clicks must forward to the agent queue and update the original card to selected/disabled state.
- Invalid/replayed clicks must not update the card.
- CLI failures must be JSON-readable and allow the agent to fall back to text.

---

## Tasks

1. Add choice card builder.
2. Add IPC server/client and CLI registration.
3. Wire IPC server into `startChannel`.
4. Update dispatcher to disable selected callback card.
5. Run focused tests, typecheck, build, commit, push, restart.
