import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { installNoteHooks, NOTE_ATTRIBUTES, NOTE_TAGS } from './node-renderer';

/**
 * #1720: the assembled spec document renders through THIS path, never through
 * `renderNodeMarkdown`, so the shared sanitizer keeps stripping `id` on every
 * other surface. Browser only: call it after mount, never during SSR (marked
 * is super-linear on adversarial input and a synchronous parse would stall the
 * portal's Node process for every user).
 *
 * It keeps exactly one thing the node path drops: the `<a id="…"></a>` anchors
 * the server writes on each part's heading (hrn:node:hadronmemory.com:specs:cor:spc:030:02,
 * ruling 0206). The portal computes no slug.
 *
 * The pattern is NOT the trust boundary, because authored HTML can write an
 * anchor of the same shape. It only has to be unable to name anything a script
 * or the portal chrome already owns: it REQUIRES A HYPHEN, and every part
 * citation holds a `:`, so every server anchor (including the `-2`/`-3`
 * collision suffixes) has one, while a global name (`window`, `constructor`,
 * `__proto__`) never does. It is a strict subset of ruling 0206 that rejects
 * nothing the server can emit.
 */
export const SPEC_ANCHOR_ID = /^[A-Za-z0-9][A-Za-z0-9._]*(?:-[A-Za-z0-9._]*)+$/;

/** Web links, mail and fragments only: no `javascript:`, `data:`, `file:` or `blob:`, no protocol-relative `//` or `/\\` (browsers read a backslash as a slash). */
const SAFE_URI = /^(?:(?:https?|mailto):|#|\/(?![\/\\]))/i;

const XHTML = 'http://www.w3.org/1999/xhtml';

let purify: ReturnType<typeof DOMPurify> | null = null;
/** Per-call state read by the hook. render is synchronous, so one slot is enough. */
let active: { container: Element | null; seen: Set<string> } | null = null;

function isServerAnchorShape(node: Element): boolean {
  return (
    node.namespaceURI === XHTML &&
    node.nodeName.toLowerCase() === 'a' &&
    node.attributes.length === 1 &&
    node.childNodes.length === 0
  );
}

function purifier(): ReturnType<typeof DOMPurify> {
  if (purify) return purify;
  const instance = DOMPurify(window);
  installNoteHooks(instance);
  instance.addHook('afterSanitizeAttributes', (node) => {
    const id = node.getAttribute?.('id');
    if (id === null || id === undefined) return;
    const state = active;
    const live = state ? (node.ownerDocument.defaultView?.document ?? document).getElementById(id) : null;
    const clashes = live !== null && !(state?.container && state.container.contains(live));
    if (
      !state ||
      !isServerAnchorShape(node) ||
      !SPEC_ANCHOR_ID.test(id) ||
      clashes ||
      state.seen.has(id)
    ) {
      node.removeAttribute('id');
      return;
    }
    state.seen.add(id);
  });
  purify = instance;
  return instance;
}

const marked = new Marked();

/**
 * The server's Markdown as sanitized HTML. `container` is the element the HTML
 * will be inserted into: a live element outside it that already owns an id
 * makes the document's anchor of that id plain, so a document cannot capture a
 * portal chrome id.
 */
export function renderSpecDocument(source: string, container: Element | null): string {
  active = { container, seen: new Set() };
  try {
    return purifier().sanitize(marked.parse(source, { async: false }) as string, {
      ALLOWED_TAGS: NOTE_TAGS,
      ALLOWED_ATTR: [...NOTE_ATTRIBUTES, 'id'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      ALLOWED_URI_REGEXP: SAFE_URI,
      FORBID_TAGS: ['style'],
    });
  } finally {
    active = null;
  }
}
