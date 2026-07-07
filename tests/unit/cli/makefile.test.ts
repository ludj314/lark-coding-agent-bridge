import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('Makefile bridge operations', () => {
  it('documents a tmux restart target for local bridge runs', async () => {
    const makefile = await readFile('Makefile', 'utf8');

    expect(makefile).toContain('restart-bridge:');
    expect(makefile).toContain('npm run build');
    expect(makefile).toContain('tmux kill-session -t $(TMUX_SESSION)');
    expect(makefile).toContain("node ./bin/lark-channel-bridge.mjs run --profile $(PROFILE)");
  });
});
