import type { RunState, ToolEntry } from './run-state';

export const PROGRESS_SEGMENT_MAX_CHARS = 10_000;
export const PROGRESS_SEGMENT_MIN_INTERVAL_MS = 120_000;
const RECENT_TOOL_LIMIT = 5;

export interface ProgressSegment {
  index: number;
  content: string;
  terminal: boolean;
}

export class ProgressSegmenter {
  private readonly maxChars: number;
  private activeIndex = 1;
  private lastContent = '';

  constructor(opts: { maxChars?: number; minIntervalMs?: number; now?: () => number } = {}) {
    this.maxChars = opts.maxChars ?? PROGRESS_SEGMENT_MAX_CHARS;
    void opts.minIntervalMs;
    void opts.now;
  }

  update(state: RunState): ProgressSegment | undefined {
    const content = renderProgressSummary(state, this.activeIndex, false).slice(0, this.maxChars);
    if (content === this.lastContent) return undefined;
    this.lastContent = content;
    return { index: this.activeIndex, content, terminal: false };
  }

  markSent(_segment: ProgressSegment): void {
    // Kept for compatibility with the caller; compact summaries update the same
    // segment and no longer emit additional history segments.
  }

  terminal(state: RunState): ProgressSegment | undefined {
    const content = renderProgressSummary(state, this.activeIndex, true).slice(0, this.maxChars);
    this.lastContent = content;
    return { index: this.activeIndex, content, terminal: true };
  }
}

function renderProgressSummary(state: RunState, index: number, terminal: boolean): string {
  const tools = state.blocks.flatMap((block) => (block.kind === 'tool' ? [block.tool] : []));
  const done = tools.filter((tool) => tool.status === 'done').length;
  const running = tools.filter((tool) => tool.status === 'running').length;
  const failed = tools.filter((tool) => tool.status === 'error').length;
  const status = terminal ? terminalStatus(state) : runningStatus(state);
  const elapsed = state.durationMs !== undefined ? `\n已用时：${formatDuration(state.durationMs)}` : '';
  const lines = [
    `进展更新 #${index}`,
    `状态：${status}${elapsed}`,
    '',
    '工具概览：',
    `- 已完成：${done}`,
    `- 进行中：${running}`,
    `- 失败：${failed}`,
  ];
  const recent = tools.slice(-RECENT_TOOL_LIMIT);
  if (recent.length > 0) {
    lines.push('', '最近动作:', ...recent.map(renderToolLine));
  }
  return lines.join('\n');
}

function renderToolLine(tool: ToolEntry): string {
  const icon = tool.status === 'done' ? '✅' : tool.status === 'error' ? '❌' : '⏳';
  return `- ${icon} **${tool.name}**${toolTarget(tool)}`;
}

function toolTarget(tool: ToolEntry): string {
  if (typeof tool.input !== 'object' || tool.input === null) return '';
  const input = tool.input as Record<string, unknown>;
  const value = input.file_path ?? input.command ?? input.path;
  return typeof value === 'string' && value ? ` — ${truncateOneLine(value, 80)}` : '';
}

function truncateOneLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

function runningStatus(state: RunState): string {
  if (state.footer === 'tool_running') return '正在调用工具';
  if (state.footer === 'streaming') return '正在输出';
  return '思考中';
}

function terminalStatus(state: RunState): string {
  if (state.terminal === 'done') return '✅ 已完成';
  if (state.terminal === 'interrupted') return '⏹ 已中断';
  if (state.terminal === 'idle_timeout') return '⏱ 已超时';
  if (state.terminal === 'error') return '⚠️ 失败';
  return runningStatus(state);
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
}
