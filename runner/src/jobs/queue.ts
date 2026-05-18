/**
 * In-process job queue fallback. Used when Redis is unavailable.
 *
 * Min-heap on a composite score so higher priority drains first and FIFO
 * holds within a tier. Score is `(maxPrio - priority) << 32 | (ts & 0xFFFFFFFF)`
 * — the MSB encodes (inverted) priority so smaller score = higher priority,
 * matching a min-heap; LSB encodes request time so older requests within a
 * tier pop first.
 */

import type { JobPriority } from "./types.ts";

export interface QueueItem {
  cluster: string;
  key: string;
  scope: "daily" | "weekly";
  priority: JobPriority;
  requested_at_ms: number;
  reason: string;
}

interface HeapNode {
  score: bigint;
  item: QueueItem;
}

// Max priority value — keep in sync with JobPriority enum. The inversion
// `MAX_PRIO - priority` turns highest-wins into a min-heap.
const MAX_PRIO = 30;

export function scoreOf(priority: JobPriority, requestedAtMs: number): bigint {
  const prioBits = BigInt(MAX_PRIO - priority) & 0xffffffffn;
  const tsBits = BigInt(requestedAtMs) & 0xffffffffn;
  return (prioBits << 32n) | tsBits;
}

export class InProcessQueue {
  private heap: HeapNode[] = [];

  push(item: QueueItem): void {
    const node: HeapNode = { score: scoreOf(item.priority, item.requested_at_ms), item };
    this.heap.push(node);
    this.siftUp(this.heap.length - 1);
  }

  pop(): QueueItem | null {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last !== undefined) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top.item;
  }

  size(): number {
    return this.heap.length;
  }

  clear(): void {
    this.heap.length = 0;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].score <= this.heap[i].score) return;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      const l = 2 * i + 1;
      const r = l + 1;
      let smallest = i;
      if (l < n && this.heap[l].score < this.heap[smallest].score) smallest = l;
      if (r < n && this.heap[r].score < this.heap[smallest].score) smallest = r;
      if (smallest === i) return;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

const _queue = new InProcessQueue();

export function pushQueue(item: QueueItem): void {
  _queue.push(item);
}

export function popQueue(): QueueItem | null {
  return _queue.pop();
}

export function queueSize(): number {
  return _queue.size();
}

export function _resetQueueForTests(): void {
  _queue.clear();
}
