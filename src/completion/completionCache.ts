/**
 * Remembers recent suggestions so we don't call the model again when:
 * - the same position is requested twice (e.g. cursor moved away and back), or
 * - the user types the beginning of the current suggestion ("typing through" it).
 */

export interface CachePosition {
  /** Identifies the document (its URI). */
  documentKey: string;
  /** Cursor offset in the document. */
  offset: number;
  prefix: string;
  suffix: string;
}

interface CacheEntry {
  documentKey: string;
  offset: number;
  prefixTail: string;
  suffixHead: string;
  completion: string;
}

const PREFIX_TAIL_LENGTH = 500;
const SUFFIX_HEAD_LENGTH = 300;

export class CompletionCache {
  private entries: CacheEntry[] = [];

  constructor(private readonly maxEntries = 50) {}

  get(position: CachePosition): string | undefined {
    const suffixHead = position.suffix.slice(0, SUFFIX_HEAD_LENGTH);
    for (const entry of this.entries) {
      const typedLength = position.offset - entry.offset;
      if (
        entry.documentKey !== position.documentKey ||
        entry.suffixHead !== suffixHead ||
        typedLength < 0 ||
        typedLength >= entry.completion.length
      ) {
        continue;
      }
      const typedText = entry.completion.slice(0, typedLength);
      if (position.prefix.endsWith(entry.prefixTail + typedText)) {
        return entry.completion.slice(typedLength);
      }
    }
    return undefined;
  }

  set(position: CachePosition, completion: string): void {
    this.entries.unshift({
      documentKey: position.documentKey,
      offset: position.offset,
      prefixTail: position.prefix.slice(-PREFIX_TAIL_LENGTH),
      suffixHead: position.suffix.slice(0, SUFFIX_HEAD_LENGTH),
      completion,
    });
    this.entries.length = Math.min(this.entries.length, this.maxEntries);
  }

  clear(): void {
    this.entries = [];
  }
}
