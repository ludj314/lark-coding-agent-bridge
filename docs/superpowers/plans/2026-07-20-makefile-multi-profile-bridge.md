# Makefile Multi-Profile Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update Makefile bridge lifecycle targets so default operations manage both `claude` and `codex`, while `PROFILE=<name>` manages only one profile.

**Architecture:** Keep the Makefile as the single orchestration file. Introduce `PROFILES ?= claude codex` and compute `TARGET_PROFILES` from whether `PROFILE` was explicitly provided on the make command line; each target loops over `TARGET_PROFILES` and uses a per-profile tmux session name.

**Tech Stack:** GNU Make, tmux, Node CLI entry `node ./bin/lark-channel-bridge.mjs run --profile <profile>`.

## Global Constraints

- Do not change bridge CLI behavior; this is Makefile-only orchestration.
- `make restart-bridge` without `PROFILE` must build once and restart both `claude` and `codex`.
- `make start-bridge`, `make stop-bridge`, `make logs-bridge`, and `make ps-bridge` without `PROFILE` must operate on both profiles.
- `make <target> PROFILE=codex` or `PROFILE=claude` must operate only on that profile.
- Each profile must use its own tmux session: `lark-bridge-claude`, `lark-bridge-codex`.
- Preserve the existing local foreground command style: `node ./bin/lark-channel-bridge.mjs run --profile <profile>`.

---

### Task 1: Update Makefile profile selection and lifecycle targets

**Files:**
- Modify: `Makefile:1-24`
- Test: `tests/unit/cli/makefile.test.ts`

**Interfaces:**
- Consumes: Existing `build`, `restart-bridge`, `logs-bridge`, `ps-bridge`, `stop-bridge` targets.
- Produces: `TARGET_PROFILES`, `session_name`, and `bridge_cmd` Makefile helpers used by lifecycle targets.

- [ ] **Step 1: Write failing Makefile contract tests**

Add expectations to `tests/unit/cli/makefile.test.ts` that read `Makefile` text and assert:

```ts
expect(source).toContain('PROFILES ?= claude codex');
expect(source).toContain('TARGET_PROFILES');
expect(source).toContain('lark-bridge-$(1)');
expect(source).toContain('start-bridge');
expect(source).toContain('restart-bridge: build');
expect(source).toContain('for profile in $(TARGET_PROFILES); do');
expect(source).toContain('node ./bin/lark-channel-bridge.mjs run --profile $$profile');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run tests/unit/cli/makefile.test.ts`

Expected before implementation: FAIL because `PROFILES ?= claude codex`, `TARGET_PROFILES`, and `start-bridge` are absent.

- [ ] **Step 3: Update Makefile**

Replace the Makefile content with:

```make
.PHONY: build start-bridge restart-bridge logs-bridge ps-bridge stop-bridge

PROFILES ?= claude codex
ifeq ($(origin PROFILE), undefined)
TARGET_PROFILES := $(PROFILES)
else
TARGET_PROFILES := $(PROFILE)
endif

session_name = lark-bridge-$(1)
bridge_cmd = node ./bin/lark-channel-bridge.mjs run --profile $(1)

build:
	npm run build

start-bridge: build
	@for profile in $(TARGET_PROFILES); do \
		session="$(call session_name,$$profile)"; \
		cmd="$(call bridge_cmd,$$profile)"; \
		if tmux has-session -t "$$session" 2>/dev/null; then \
			echo "already running $$session: $$cmd"; \
		else \
			tmux new -d -s "$$session" "$$cmd"; \
			echo "started $$session: $$cmd"; \
		fi; \
	done

restart-bridge: build
	@for profile in $(TARGET_PROFILES); do \
		session="$(call session_name,$$profile)"; \
		cmd="$(call bridge_cmd,$$profile)"; \
		tmux kill-session -t "$$session" 2>/dev/null || true; \
		tmux new -d -s "$$session" "$$cmd"; \
		echo "restarted $$session: $$cmd"; \
		tmux capture-pane -t "$$session" -p -S -20; \
	done

logs-bridge:
	@for profile in $(TARGET_PROFILES); do \
		session="$(call session_name,$$profile)"; \
		echo "== $$session =="; \
		tmux capture-pane -t "$$session" -p -S -80 2>/dev/null || echo "not running"; \
	done

ps-bridge:
	@tmux list-sessions 2>/dev/null | grep '^lark-bridge-' || true
	@ps -ef | grep lark-channel-bridge | grep -v grep || true

stop-bridge:
	@for profile in $(TARGET_PROFILES); do \
		session="$(call session_name,$$profile)"; \
		tmux kill-session -t "$$session" 2>/dev/null && echo "stopped $$session" || echo "not running $$session"; \
	done
```

- [ ] **Step 4: Run focused tests**

Run: `npm test -- --run tests/unit/cli/makefile.test.ts`

Expected: PASS.

- [ ] **Step 5: Run non-destructive Makefile dry-runs**

Run:

```bash
make -n restart-bridge
make -n restart-bridge PROFILE=codex
make -n start-bridge
make -n stop-bridge PROFILE=claude
```

Expected:
- default dry-runs include both `claude` and `codex` through `TARGET_PROFILES` loop;
- `PROFILE=codex` dry-run uses only `codex` as `TARGET_PROFILES`.

- [ ] **Step 6: Commit**

```bash
git add Makefile tests/unit/cli/makefile.test.ts docs/superpowers/plans/2026-07-20-makefile-multi-profile-bridge.md
git commit -m "chore: support multi-profile bridge make targets"
```

## Self-Review

- Spec coverage: The single Makefile task covers all approved方案一 requirements: default claude+codex operations and `PROFILE=<name>` single-profile operations.
- Placeholder scan: No TBD/TODO placeholders remain.
- Type consistency: Makefile helper names are consistent across all targets.
