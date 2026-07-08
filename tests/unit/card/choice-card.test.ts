import { describe, expect, it } from 'vitest';
import { choiceCard, selectedChoiceCard } from '../../../src/card/choice-card.js';

describe('choice callback cards', () => {
  it('builds signed callback buttons', () => {
    const card = choiceCard({
      title: '选一个',
      choices: [
        { choice: 'do', label: '开工做' },
        { choice: 'skip', label: '不做' },
      ],
      action: 'agent_callback',
      sign: (choice) => `token-${choice}`,
    }) as { body?: { elements?: unknown[] } };
    const raw = JSON.stringify(card);

    expect(raw).toContain('开工做');
    expect(raw).toContain('不做');
    expect(raw).toContain('__bridge_cb');
    expect(raw).toContain('token-do');
    expect(raw).toContain('token-skip');
  });

  it('renders selected state without callback buttons', () => {
    const card = selectedChoiceCard({ title: '选一个', selectedLabel: '开工做' });
    const raw = JSON.stringify(card);

    expect(raw).toContain('已选择：开工做');
    expect(raw).not.toContain('__bridge_cb');
    expect(raw).not.toContain('button');
  });
});
