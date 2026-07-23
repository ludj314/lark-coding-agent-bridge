import type { ToolEntry } from './run-state';

const HEADER_SUMMARY_MAX = 80;
const BODY_FIELD_MAX = 600;
const OUTPUT_MAX = 1200;
/**
 * Cumulative cap on a tool's full body markdown (input + output + code fences
 * + headers). Even with per-field caps, pathological tools (many input
 * fields + maxed-out output) can stack to multi-KB bodies which, multiplied
 * across panels, push the card past Feishu's per-element size limit. This
 * is the last belt across the whole rendered body string.
 */
const BODY_TOTAL_MAX = 2500;

export function toolHeaderText(tool: ToolEntry): string {
  const icon = tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏳';
  const summary = summarizeInput(tool.name, tool.input);
  return summary ? `${icon} **${tool.name}** — ${summary}` : `${icon} **${tool.name}**`;
}

export function toolBodyMd(tool: ToolEntry): string {
  const parts: string[] = [];
  const inputMd = renderInput(tool);
  if (inputMd) parts.push(inputMd);

  if (tool.output) {
    const truncated = truncate(tool.output, OUTPUT_MAX);
    if (tool.status === 'error') {
      parts.push(`**Error**\n\`\`\`\n${truncated}\n\`\`\``);
    } else if (tool.name === 'Bash') {
      parts.push(renderBashOutput(truncated));
    } else {
      parts.push(`**Output**\n\`\`\`\n${truncated}\n\`\`\``);
    }
  } else if (tool.status === 'running') {
    parts.push('_运行中…_');
  }

  const body = parts.join('\n\n');
  if (body.length <= BODY_TOTAL_MAX) return body;
  return `${body.slice(0, BODY_TOTAL_MAX)}…\n\n_（body 已截断,完整内容查 \`/doctor\` 或日志）_`;
}

function summarizeInput(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  const pick = (key: string, max = HEADER_SUMMARY_MAX): string => {
    const v = rec[key];
    if (typeof v !== 'string') return '';
    const oneLine = v.replace(/\s+/g, ' ').trim();
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
  };
  switch (name) {
    case 'Bash':
      return pick('command');
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return shortenPath(pick('file_path'));
    case 'Grep': {
      const pat = pick('pattern', 40);
      const path = pick('path', 30);
      return path ? `${pat} in ${shortenPath(path)}` : pat;
    }
    case 'Glob':
      return pick('pattern');
    case 'WebFetch':
      return pick('url');
    case 'WebSearch':
      return pick('query', 60);
    case 'Agent':
    case 'Task':
      return pick('description') || pick('subagent_type');
    case 'Skill':
      return pick('skill') || pick('args');
    case 'TaskCreate':
      return pick('subject') || pick('description');
    case 'TaskUpdate':
      return summarizeTaskUpdate(rec);
    case 'TaskGet': {
      const taskId = pick('taskId', 20);
      return taskId ? `#${taskId}` : '';
    }
    default:
      return pick('command') || pick('file_path') || pick('path') || pick('query');
  }
}

function summarizeTaskUpdate(rec: Record<string, unknown>): string {
  const taskId = typeof rec.taskId === 'string' ? rec.taskId.trim() : '';
  const status = typeof rec.status === 'string' ? rec.status.trim() : '';
  const subject = typeof rec.subject === 'string' ? rec.subject.replace(/\s+/g, ' ').trim() : '';
  const owner = typeof rec.owner === 'string' ? rec.owner.trim() : '';
  const head = taskId ? `#${taskId}` : '';
  const transition = status ? `${head ? `${head} → ` : ''}${status}` : head;
  const suffix = subject ? ` (${truncate(subject, 48)})` : owner ? ` (owner: ${truncate(owner, 32)})` : '';
  return `${transition}${suffix}`.trim();
}

function renderInput(tool: ToolEntry): string {
  const input = tool.input;
  if (!input || typeof input !== 'object') return '';
  const rec = input as Record<string, unknown>;
  const str = (k: string): string => (typeof rec[k] === 'string' ? rec[k] as string : '');

  switch (tool.name) {
    case 'Bash': {
      const cmd = str('command');
      return cmd ? `**Command**\n\`\`\`bash\n${truncate(cmd, BODY_FIELD_MAX)}\n\`\`\`` : '';
    }
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const fp = str('file_path');
      return fp ? `**File** \`${fp}\`` : '';
    }
    case 'Grep': {
      const lines: string[] = [];
      if (str('pattern')) lines.push(`**Pattern** \`${str('pattern')}\``);
      if (str('path')) lines.push(`**Path** \`${str('path')}\``);
      return lines.join('\n');
    }
    case 'WebFetch':
      return str('url') ? `**URL** ${str('url')}` : '';
    case 'WebSearch':
      return str('query') ? `**Query** \`${truncate(str('query'), BODY_FIELD_MAX)}\`` : '';
    case 'Skill': {
      const lines: string[] = [];
      if (str('skill')) lines.push(`**Skill** \`${str('skill')}\``);
      if (str('args')) lines.push(`**Args** ${truncate(str('args'), BODY_FIELD_MAX)}`);
      return lines.join('\n');
    }
    case 'TaskCreate': {
      const lines: string[] = [];
      if (str('subject')) lines.push(`**Subject** ${truncate(str('subject'), BODY_FIELD_MAX)}`);
      if (str('description')) lines.push(`**Description** ${truncate(str('description'), BODY_FIELD_MAX)}`);
      if (str('activeForm')) lines.push(`**Active form** ${truncate(str('activeForm'), BODY_FIELD_MAX)}`);
      return lines.join('\n');
    }
    case 'TaskUpdate':
    case 'TaskGet': {
      const lines: string[] = [];
      if (str('taskId')) lines.push(`**Task** \`#${str('taskId')}\``);
      if (str('status')) lines.push(`**Status** \`${str('status')}\``);
      if (str('owner')) lines.push(`**Owner** \`${str('owner')}\``);
      if (str('subject')) lines.push(`**Subject** ${truncate(str('subject'), BODY_FIELD_MAX)}`);
      if (str('description')) lines.push(`**Description** ${truncate(str('description'), BODY_FIELD_MAX)}`);
      return lines.join('\n');
    }
    default:
      return '';
  }
}

function renderBashOutput(out: string): string {
  // Some agents wrap stdout/stderr in xml-like tags; keep simple and just dump.
  return `**Output**\n\`\`\`\n${out}\n\`\`\``;
}

function shortenPath(p: string): string {
  return p;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
