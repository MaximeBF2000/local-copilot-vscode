/**
 * Line-number bookkeeping for a pending inline edit: the original lines ("old" block)
 * and the proposed lines inserted below them ("new" block). Pure logic, no VS Code dependency.
 */

export interface LineBlock {
  start: number;
  /** Inclusive. A block with end < start is empty. */
  end: number;
}

export interface PendingBlocks {
  old: LineBlock;
  proposed: LineBlock;
}

export interface LineChange {
  startLine: number;
  endLine: number;
  /** Number of lines added minus number of lines removed. */
  lineDelta: number;
}

export type ChangeEffect = 'shifted' | 'unaffected' | 'touchesOld' | 'touchesProposed';

function isEmpty(block: LineBlock): boolean {
  return block.end < block.start;
}

function overlaps(block: LineBlock, change: LineChange): boolean {
  return !isEmpty(block) && change.startLine <= block.end && change.endLine >= block.start;
}

/** How an edit made by the user affects the pending blocks. */
export function classifyChange(blocks: PendingBlocks, change: LineChange): ChangeEffect {
  if (overlaps(blocks.proposed, change)) {
    return 'touchesProposed';
  }
  if (overlaps(blocks.old, change)) {
    return 'touchesOld';
  }
  const firstLine = isEmpty(blocks.old) ? blocks.proposed.start : blocks.old.start;
  return change.endLine < firstLine ? 'shifted' : 'unaffected';
}

export function shiftBlocks(blocks: PendingBlocks, lineDelta: number): PendingBlocks {
  const shift = (block: LineBlock): LineBlock => ({ start: block.start + lineDelta, end: block.end + lineDelta });
  return { old: shift(blocks.old), proposed: shift(blocks.proposed) };
}
