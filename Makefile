.PHONY: build restart-bridge logs-bridge ps-bridge stop-bridge

PROFILE ?= claude
TMUX_SESSION ?= lark-bridge
BRIDGE_CMD := node ./bin/lark-channel-bridge.mjs run --profile $(PROFILE)

build:
	npm run build

restart-bridge: build
	@tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true
	@tmux new -d -s $(TMUX_SESSION) '$(BRIDGE_CMD)'
	@echo "restarted $(TMUX_SESSION): $(BRIDGE_CMD)"
	@tmux capture-pane -t $(TMUX_SESSION) -p -S -20

logs-bridge:
	@tmux capture-pane -t $(TMUX_SESSION) -p -S -80

ps-bridge:
	@ps -ef | grep lark-channel-bridge | grep -v grep || true

stop-bridge:
	@tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true
