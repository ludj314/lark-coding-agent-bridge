import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Makefile bridge operations', () => {
  it('supports multi-profile bridge lifecycle targets by default', async () => {
    const makefile = await readFile('Makefile', 'utf8');

    expect(makefile).toContain('PROFILES ?= claude codex');
    expect(makefile).toContain('TARGET_PROFILES');
    expect(makefile).toContain('lark-bridge-$(1)');
    expect(makefile).toContain('start-bridge: build');
    expect(makefile).toContain('restart-bridge: build');
    expect(makefile).toContain('for profile in $(TARGET_PROFILES); do');
    expect(makefile).toContain('bridge_cmd = node ./bin/lark-channel-bridge.mjs run --profile $(1)');
    expect(makefile).toContain('cmd="$(call bridge_cmd,$$profile)"');
  });
});
