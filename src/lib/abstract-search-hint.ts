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
 * `Memory.embeddingSource` is non-null on the server (column default
 * `abstract`), so a null or missing value here means the page did not load
 * it, NOT "abstract". An unknown source makes no claim, like a disabled index
 * (the embedder, hadron-server `jobs/embedNodes.ts`, embeds the abstract only
 * for `abstract` and `both`).
 */
import { t } from '$lib/i18n/t';

export interface VectorConfig {
  vectorIndexEnabled?: boolean | null;
  embeddingSource?: 'abstract' | 'contentChunks' | 'both' | null;
}

/** The reader-facing hint, or null when there is nothing true to say about search. */
export function abstractSearchHint(memory: VectorConfig | null | undefined): string | null {
  if (!memory || memory.vectorIndexEnabled !== true) return null;
  switch (memory.embeddingSource) {
    case 'abstract':
      return t(
        'node.abstract.search-hint.abstract',
        'Vector search in this memory finds nodes by their abstract, so a node without one isn’t found.',
      );
    case 'both':
      return t('node.abstract.search-hint.both', 'Vector search in this memory finds nodes by their abstract and their content.');
    case 'contentChunks':
      return t('node.abstract.search-hint.content-chunks', 'Vector search in this memory finds nodes by their content, not their abstract.');
    default:
      // Not loaded, or a source added server-side later: say nothing rather
      // than guess.
      return null;
  }
}

/** The placeholder for an abstract field: what an abstract IS, with no search claim. */
export function abstractPlaceholder(): string {
  return t('node.abstract.placeholder', 'A paragraph-length summary of this node.');
}
