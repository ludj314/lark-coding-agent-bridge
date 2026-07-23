import { describe, expect, it } from 'vitest';
import { toolBodyMd, toolHeaderText } from '../../../src/card/tool-render.js';
import type { ToolEntry } from '../../../src/card/run-state.js';

describe('tool rendering summaries', () => {
  it('shows skill names directly in progress rows', () => {
    expect(toolHeaderText(tool('Skill', { skill: 'systematic-debugging' }))).toBe(
      '⏳ **Skill** — systematic-debugging',
    );
  });

  it('shows task creation subjects directly in progress rows', () => {
    expect(toolHeaderText(tool('TaskCreate', {
      subject: 'Verify group access policy',
      description: 'Run tests and do not restart services.',
    }))).toBe('⏳ **TaskCreate** — Verify group access policy');
  });

  it('shows task update id, status, and subject directly in progress rows', () => {
    expect(toolHeaderText(tool('TaskUpdate', {
      taskId: '34',
      status: 'completed',
      subject: 'Verify group access policy',
    }, 'done'))).toBe('✅ **TaskUpdate** — #34 → completed (Verify group access policy)');
  });

  it('renders skill and task input details without relying on hidden JSON', () => {
    expect(toolBodyMd(tool('Skill', { skill: 'brainstorming', args: 'progress cards' }))).toContain('**Skill** `brainstorming`');
    const taskBody = toolBodyMd(tool('TaskUpdate', { taskId: '9', status: 'in_progress', owner: 'Celia', subject: 'Patch topic workspace inheritance' }));
    expect(taskBody).toContain('**Task** `#9`');
    expect(taskBody).toContain('**Status** `in_progress`');
    expect(taskBody).toContain('**Owner** `Celia`');
    expect(taskBody).toContain('**Subject** Patch topic workspace inheritance');
  });
});

function tool(name: string, input: unknown, status: ToolEntry['status'] = 'running'): ToolEntry {
  return { id: `tool-${name}`, name, input, status };
}
