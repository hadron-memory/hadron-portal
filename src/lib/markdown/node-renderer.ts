import DOMPurify from 'dompurify';
import type { Marked } from 'marked';
import { wikilinkExtension, type WikilinkMap, type WikilinkStrings } from './wikilink';

export function createNodeMarkdownRenderer(
  MarkedClass: typeof Marked,
  wikilinks: WikilinkMap,
  strings: WikilinkStrings,
): Marked {
  return new MarkedClass({ extensions: [wikilinkExtension(wikilinks, strings)] });
}

export function renderNodeMarkdown(renderer: Marked, source: string): string {
  // Preserve authored HTML (including inline styles) while sanitizing every
  // output path before the node page inserts it with {@html}.
  return DOMPurify.sanitize(renderer.parse(source, { async: false }) as string, {
    // A stylesheet element can target the whole portal, outside node content.
    // Inline style attributes still support local formatting such as spec blocks.
    FORBID_TAGS: ['style'],
  });
}
