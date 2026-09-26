/**
 * #936 — what, if anything, a node's abstract does for this memory's vector
 * search, worded from the memory's EFFECTIVE configuration.
 *
 * The node forms used to say the abstract is "the default source for vector
 * search" everywhere. It isn't: a knowledge memory created through the
 * server's createMemory defaults to `embeddingSource: contentChunks` with the
 * index on (hadron-server resolvers.mutation.memory.ts; spec 033). There the
 * abstract is not embedded at all, and a memory with no index embeds
 * nothing. So the hint is derived per memory, and a memory whose config the
 * page doesn't have gets no claim at all.
 *
 * A null `embeddingSource` means the column default, `abstract`, the same
 * reading the org memories list and the settings page apply.
 */
import { t } from '$lib/i18n/t';

export interface VectorConfig {
  vectorIndexEnabled?: boolean | null;
  embeddingSource?: 'abstract' | 'contentChunks' | 'both' | null;
}

/** The reader-facing hint, or null when there is nothing true to say about search. */
export function abstractSearchHint(memory: VectorConfig | null | undefined): string | null {
  if (!memory || memory.vectorIndexEnabled !== true) return null;
  switch (memory.embeddingSource ?? 'abstract') {
    case 'abstract':
      return t(
        'node.abstract.search-hint.abstract',
        'This memory’s vector search embeds abstracts, so the abstract is what search matches this node on.',
      );
    case 'both':
      return t(
        'node.abstract.search-hint.both',
        'This memory’s vector search embeds both abstracts and content.',
      );
    case 'contentChunks':
      return t(
        'node.abstract.search-hint.content-chunks',
        'This memory’s vector search embeds node content, not abstracts.',
      );
    default:
      // A source added server-side later: say nothing rather than guess.
      return null;
  }
}

/** The placeholder for an abstract field: what an abstract IS, with no search claim. */
export function abstractPlaceholder(): string {
  return t('node.abstract.placeholder', 'A paragraph-length summary of this node.');
}
