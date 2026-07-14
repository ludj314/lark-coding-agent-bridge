import type { Block, RunState, ToolEntry } from './run-state';
import { toolHeaderText } from './tool-render';

export const PROGRESS_SEGMENT_MAX_CHARS = 10_000;
export const PROGRESS_SEGMENT_MIN_INTERVAL_MS = 120_000;
const HEADER_RESERVE = 80;

export interface ProgressSegment {
  index: number;
  content: string;
  terminal: boolean;
}

export class ProgressSegmenter {
  private readonly maxChars: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private emittedChars = 0;
  private activeIndex = 1;
  private lastSentAt = 0;
  private activeStart = 0;
  private activeContent = '';
  private activeFull = false;

  constructor(opts: { maxChars?: number; minIntervalMs?: number; now?: () => number } = {}) {
    this.maxChars = opts.maxChars ?? PROGRESS_SEGMENT_MAX_CHARS;
    this.minIntervalMs = opts.minIntervalMs ?? PROGRESS_SEGMENT_MIN_INTERVAL_MS;
    this.now = opts.now ?? Date.now;
  }

  update(state: RunState): ProgressSegment | undefined {
    const full = renderProgressBody(state).trim();
    const header = this.header(state, false);
    const bodyBudget = Math.max(0, this.maxChars - header.length - HEADER_RESERVE);
    const currentActive = full.slice(this.activeStart, this.emittedChars);
    if (!this.activeFull && currentActive && currentActive !== this.activeContent) {
      this.activeContent = full.slice(this.activeStart, this.activeStart + bodyBudget);
      this.emittedChars = this.activeStart + this.activeContent.length;
      return this.segment(state, false);
    }
    const delta = full.slice(this.emittedChars);
    if (!delta) return undefined;

    if (this.activeFull) {
      if (this.now() - this.lastSentAt < this.minIntervalMs) return undefined;
      this.activeIndex += 1;
      this.activeStart = this.emittedChars;
      this.activeContent = '';
      this.activeFull = false;
    }

    const available = Math.max(0, bodyBudget - this.activeContent.length);
    if (available <= 0) {
      this.activeFull = true;
      return undefined;
    }

    const chunk = delta.slice(0, available);
    this.activeContent += chunk;
    this.emittedChars += chunk.length;
    if (chunk.length < delta.length || this.activeContent.length >= bodyBudget) {
      // This segment is full. Drop the overflow from this full-state render;
      // future segments should contain only content produced after this cutoff,
      // not the remainder of an already-truncated oversized update.
      this.emittedChars = full.length;
      this.activeFull = true;
    }

    return this.segment(state, false);
  }

  markSent(_segment: ProgressSegment): void {
    this.lastSentAt = this.now();
  }

  terminal(state: RunState): ProgressSegment | undefined {
    if (!this.activeContent && this.emittedChars === 0) return undefined;
    return this.segment(state, true);
  }

  private segment(state: RunState, terminal: boolean): ProgressSegment {
    const content = `${this.header(state, terminal)}\n\n${this.activeContent}`.slice(0, this.maxChars);
    return { index: this.activeIndex, content, terminal };
  }

  private header(state: RunState, terminal: boolean): string {
    const status = terminal ? terminalStatus(state) : runningStatus(state);
    const elapsed = state.durationMs !== undefined ? `\n已用时：${formatDuration(state.durationMs)}` : '';
    return `进展更新 #${this.activeIndex}\n状态：${status}${elapsed}`;
  }
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
