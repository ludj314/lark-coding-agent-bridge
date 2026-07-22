# Group Mention Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any group/topic member trigger a bot by direct @ mention without requiring `allowedChats`, while preserving DM and admin-command gates.

**Architecture:** Change only the group runtime access decision in `src/policy/access.ts`. Keep `allowedChats` in config, `/invite`, `/remove`, and config UI for compatibility, but make `canUseGroup` allow non-admin/non-owner group messages; `channel.ts` still enforces direct @ mentions via `requireMentionInGroup`.

**Tech Stack:** TypeScript, Vitest, existing access-policy unit tests and IM integration tests.

## Global Constraints

- Group/topic runtime messages no longer require `allowedChats`.
- Group/topic messages must still satisfy the existing direct bot mention gate when `requireMentionInGroup` is true.
- DM access remains owner / allowedUsers / admins only.
- Admin commands remain owner / admins only.
- Do not remove `allowedChats` schema/config/UI in this change.

---

### Task 1: Change group runtime access policy

**Files:**
- Modify: `src/policy/access.ts:13-70`
- Modify: `tests/unit/policy/access.test.ts:75-84`
- Test: `tests/integration/bot/claude-regression.test.ts`

**Interfaces:**
- Consumes: `canUseGroup(profile, controls, chatId, senderId): AccessDecision`.
- Produces: `canUseGroup` returns `{ok: true, reason: 'allowed-chat'}` for any non-owner/non-admin group sender; `canUseDm` and `canRunAdminCommand` remain unchanged.

- [ ] **Step 1: Write failing unit test**

Update the group access test in `tests/unit/policy/access.test.ts` so a profile with empty `allowedChats` allows a non-owner sender in a group:

```ts
it('allows group messages regardless of allowedChats; mention gating happens at intake', () => {
  const closed = profileWithAccess({ allowedChats: [] });
  expect(canUseGroup(closed, ownerControls, 'chat_new', 'ou_other')).toEqual({
    ok: true,
    reason: 'allowed-chat',
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/policy/access.test.ts`

Expected before implementation: FAIL because `canUseGroup` returns `{ok:false, reason:'denied-chat'}`.

- [ ] **Step 3: Implement minimal policy change**

Change `canUseGroup` in `src/policy/access.ts` to:

```ts
export function canUseGroup(
  _profile: ProfileConfig,
  controls: RuntimeControls,
  _chatId: string,
  senderId: string,
): AccessDecision {
  if (isCreator(controls, senderId)) return allow('owner');
  return allow('allowed-chat');
}
```

Keep the `AccessDecision['reason']` union unchanged for compatibility.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- --run tests/unit/policy/access.test.ts tests/integration/bot/claude-regression.test.ts tests/integration/bot/access-gate.test.ts
```

Expected: PASS. The regression test still verifies non-mentioned group chatter is dropped by `channel.ts`.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/policy/access.ts tests/unit/policy/access.test.ts docs/superpowers/plans/2026-07-22-group-mention-access.md
git commit -m "fix: allow mentioned group messages without chat allowlist"
```

## Self-Review

- Spec coverage: The task covers group/topic allowlist removal, preserves mention gating, and leaves DM/admin command gates untouched.
- Placeholder scan: No placeholders remain.
- Type consistency: `canUseGroup` signature stays unchanged; only implementation semantics change.
