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
