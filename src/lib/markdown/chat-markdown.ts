/**
 * Markdown for the surfaces that have no containing memory — team chat, node
 * comments, agent/worker chats, the worker briefing (#1493).
 *
 * They render `[[hrn:node:…|label]]` (and `[label](hrn:node:…)`) as a link to the
 * node, through the same renderer the node page uses, so the rule is not copied.
 * Spec: hrn:node:hadronmemory.com:specs:cor:urn:020:01.
 *
 * Two deliberate differences from the node page:
 *  - Only a fully qualified target is claimed. A bare `[[loc]]` has no memory to
 *    resolve against here and stays as written.
 *  - There is no lookup, so every link is the "unchecked" form: the `/app/u/<urn>`
 *    resolver route, which applies access control on click. The link text is the
 *    authored label, else the URN. Nothing is checked, so no node name or
 *    existence is revealed, and a broken-link marker is never shown.
 *
 * The result is NOT sanitized — callers pass it to DOMPurify before `{@html}`
 * (Portal Invariant P4, hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
 */

import { Marked } from 'marked';
import { t } from '$lib/i18n/t';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { encodeUrnPathSegment } from '$lib/urn/encode-urn-segment';
import { createNodeMarkdownRenderer } from './node-renderer';
import { extractWikilinks, type WikilinkMap } from './wikilink';

export function renderChatMarkdown(source: string): string {
  const links: WikilinkMap = {};
  for (const ref of extractWikilinks(source)) {
    // Only node-prefixed targets are claimed by the renderer; the rest need no entry.
    if (!ref.memoryUrn || !/^(?:hrn|urn):node:/i.test(ref.target)) continue;
    try {
      links[ref.target] = {
        // #1512: one encoded segment, so an authored `../` cannot leave /app/u/.
        href: `/app/u/${encodeUrnPathSegment(composeNodeUrn(ref.memoryUrn, ref.loc))}`,
        label: ref.target,
      };
    } catch {
      // Cannot build a URN to point at: leave the target out of the map and the
      // renderer shows the authored text as an unresolved marker.
    }
  }
  const renderer = createNodeMarkdownRenderer(
    Marked,
    links,
    { unresolvedTitle: t('markdown.wikilink.unresolved', 'Unresolved reference: no node at {target}') },
    { qualifiedOnly: true },
  );
  return renderer.parse(source, { async: false }) as string;
}
