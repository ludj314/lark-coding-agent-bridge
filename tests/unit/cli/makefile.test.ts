import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Makefile bridge operations', () => {
  it('uses service-level lifecycle commands for claude and codex profiles', async () => {
    const makefile = await readFile('Makefile', 'utf8');

    expect(makefile).toContain('PROFILES ?= claude codex');
    expect(makefile).toContain('TARGET_PROFILES');
    expect(makefile).toContain('BRIDGE_CLI := node ./bin/lark-channel-bridge.mjs');
    expect(makefile).toContain('start-bridge: build');
    expect(makefile).toContain('restart-bridge: build');
    expect(makefile).toContain('for profile in $(TARGET_PROFILES); do');
    expect(makefile).toContain('$(BRIDGE_CLI) restart --profile $$profile');
    expect(makefile).toContain('$(BRIDGE_CLI) start --profile $$profile');
    expect(makefile).toContain('$(BRIDGE_CLI) stop --profile $$profile');
    expect(makefile).toContain('$(BRIDGE_CLI) status --profile $$profile');
  });

  it('does not start bridge daemons through tmux foreground run sessions', async () => {
    const makefile = await readFile('Makefile', 'utf8');

    expect(makefile).not.toContain('tmux new -d');
    expect(makefile).not.toContain('run --profile $(1)');
    expect(makefile).not.toContain('lark-bridge-$(1)');
  });
});
