.PHONY: build start-bridge restart-bridge logs-bridge ps-bridge stop-bridge clean-bridge-tmux

PROFILES ?= claude codex
ifeq ($(origin PROFILE), undefined)
TARGET_PROFILES := $(PROFILES)
else
TARGET_PROFILES := $(PROFILE)
endif

BRIDGE_CLI := node ./bin/lark-channel-bridge.mjs

build:
	npm run build

clean-bridge-tmux:
	@tmux kill-session -t lark-bridge 2>/dev/null || true
	@for profile in $(TARGET_PROFILES); do \
		tmux kill-session -t "lark-bridge-$$profile" 2>/dev/null || true; \
	done

start-bridge: build clean-bridge-tmux
	@for profile in $(TARGET_PROFILES); do \
		echo "starting bridge profile $$profile"; \
		$(BRIDGE_CLI) start --profile $$profile; \
	done

restart-bridge: build clean-bridge-tmux
	@for profile in $(TARGET_PROFILES); do \
		echo "restarting bridge profile $$profile"; \
		$(BRIDGE_CLI) restart --profile $$profile; \
	done

logs-bridge:
	@for profile in $(TARGET_PROFILES); do \
		echo "== $$profile daemon logs =="; \
		$(BRIDGE_CLI) status --profile $$profile; \
		tail -n 80 "/home/ludejian/.lark-channel/profiles/$$profile/logs/daemon/daemon-stdout.log" 2>/dev/null || true; \
		tail -n 80 "/home/ludejian/.lark-channel/profiles/$$profile/logs/daemon/daemon-stderr.log" 2>/dev/null || true; \
	done

ps-bridge:
	@$(BRIDGE_CLI) ps

stop-bridge: clean-bridge-tmux
	@for profile in $(TARGET_PROFILES); do \
		echo "stopping bridge profile $$profile"; \
		$(BRIDGE_CLI) stop --profile $$profile; \
	done
