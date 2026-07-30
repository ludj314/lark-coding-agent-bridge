import type { Block, RunState, ToolEntry } from './run-state';
import { toolHeaderText } from './tool-render';

export const PROGRESS_SEGMENT_MAX_CHARS = 10_000;
export const PROGRESS_SEGMENT_NEXT_MIN_CHARS = 500;
const HEADER_RESERVE = 80;

export interface ProgressSegment {
  index: number;
  content: string;
  terminal: boolean;
}

export class ProgressSegmenter {
  private readonly maxChars: number;
  private readonly nextSegmentMinChars: number;
  private readonly now: () => number;
  private emittedChars = 0;
  private activeIndex = 1;
  private lastSentAt = 0;
  private activeStart = 0;
  private activeContent = '';
  private activeComplete = false;

  constructor(opts: { maxChars?: number; minIntervalMs?: number; nextSegmentMinChars?: number; now?: () => number } = {}) {
    this.maxChars = opts.maxChars ?? PROGRESS_SEGMENT_MAX_CHARS;
    this.nextSegmentMinChars = opts.nextSegmentMinChars ?? PROGRESS_SEGMENT_NEXT_MIN_CHARS;
    this.now = opts.now ?? Date.now;
  }

  update(state: RunState): ProgressSegment | undefined {
    const full = renderProgressBody(state).trim();
    const bodyBudget = this.bodyBudget(state, false);

    if (!this.activeComplete) {
      const activeEnd = findSegmentEnd(full, this.activeStart, bodyBudget, false);
      const nextActiveContent = full.slice(this.activeStart, activeEnd);
      if (!nextActiveContent) return undefined;
      if (nextActiveContent !== this.activeContent) {
        this.activeContent = nextActiveContent;
        this.emittedChars = this.activeStart + this.activeContent.length;
        this.activeComplete = this.emittedChars < full.length;
        return this.segment(state, false);
      }
      this.activeComplete = this.emittedChars < full.length;
    }

    if (!this.activeComplete) return undefined;

    const pendingLength = full.length - this.emittedChars;
    if (pendingLength < this.nextSegmentMinChars) return undefined;

    this.activeIndex += 1;
    this.activeStart = this.emittedChars;
    const activeEnd = findSegmentEnd(full, this.activeStart, bodyBudget, false);
    this.activeContent = full.slice(this.activeStart, activeEnd);
    this.emittedChars = this.activeStart + this.activeContent.length;
    this.activeComplete = this.emittedChars < full.length;
    return this.segment(state, false);
  }

  markSent(_segment: ProgressSegment): void {
    this.lastSentAt = this.now();
  }

  terminal(state: RunState): ProgressSegment | undefined {
    return this.terminalSegments(state)[0];
  }

  terminalSegments(state: RunState): ProgressSegment[] {
    const full = renderProgressBody(state).trim();
    if (!this.activeContent && this.emittedChars === 0 && !full) return [];

    const segments: ProgressSegment[] = [];
    if (this.activeContent || this.emittedChars > this.activeStart) {
      segments.push(this.segment(state, true));
    }

    const bodyBudget = this.bodyBudget(state, true);
    while (this.emittedChars < full.length) {
      this.activeIndex += 1;
      this.activeStart = this.emittedChars;
      const activeEnd = findSegmentEnd(full, this.activeStart, bodyBudget, true);
      this.activeContent = full.slice(this.activeStart, activeEnd);
      this.emittedChars = this.activeStart + this.activeContent.length;
      this.activeComplete = this.emittedChars < full.length;
      segments.push(this.segment(state, true));
    }

    return segments;
  }

  private segment(state: RunState, terminal: boolean): ProgressSegment {
    const content = `${this.header(state, terminal)}\n\n${this.activeContent}`;
    return { index: this.activeIndex, content, terminal };
  }

  private bodyBudget(state: RunState, terminal: boolean): number {
    const header = this.header(state, terminal);
    return Math.max(0, this.maxChars - header.length - HEADER_RESERVE);
  }

  private header(state: RunState, terminal: boolean): string {
    const status = terminal ? terminalStatus(state) : runningStatus(state);
    const elapsed = state.durationMs !== undefined ? `\n已用时：${formatDuration(state.durationMs)}` : '';
    return `进展更新 #${this.activeIndex}\n状态：${status}${elapsed}`;
  }
}

function findSegmentEnd(full: string, start: number, budget: number, terminal: boolean): number {
  if (start >= full.length) return start;
  const target = Math.min(full.length, start + budget);
  if (target >= full.length) return full.length;

  const boundary = findBoundaryAtOrAfter(full, target, start);
  if (boundary !== undefined) return boundary;

  if (!terminal) return full.length;
  return Math.min(full.length, Math.max(start + 1, target));
}

function findBoundaryAtOrAfter(full: string, target: number, start: number): number | undefined {
  for (let i = target; i < full.length; i += 1) {
    if (isBoundary(full, i)) return i + 1;
  }

  for (let i = target - 1; i >= start; i -= 1) {
    if (isBoundary(full, i)) return i + 1;
  }

  return undefined;
}

function isBoundary(full: string, index: number): boolean {
  const char = full[index];
  if (!char) return false;
  if (char === '\n') return true;
  if (/[。！？.!?]/u.test(char)) return true;
  return false;
}

function renderProgressBody(state: RunState): string {
  const tools = renderLatestTools(state.blocks);
  const text = renderTextBlocks(state.blocks);
  return [tools, text].filter(Boolean).join('\n\n');
}

function renderLatestTools(blocks: Block[]): string {
  const latest = blocks
    .filter((block): block is { kind: 'tool'; tool: ToolEntry } => block.kind === 'tool')
    .map((block) => block.tool)
    .slice(-3);
  if (latest.length === 0) return '';
  return `**当前执行**\n${latest.map((tool, index) => `${index + 1}. ${toolHeaderText(tool)}`).join('\n')}`;
}

function renderTextBlocks(blocks: Block[]): string {
  return blocks
    .filter((block): block is { kind: 'text'; content: string; streaming: boolean } => block.kind === 'text')
    .map((block) => block.content.trim())
    .filter(Boolean)
    .join('\n\n');
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
