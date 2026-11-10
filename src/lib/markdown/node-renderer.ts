import DOMPurify from 'dompurify';
import type { Marked } from 'marked';
import { wikilinkExtension, WIKILINK_UNRESOLVED_CLASS, type WikilinkMap, type WikilinkStrings } from './wikilink';

// Authored styles can decorate node content, but layout/positioning properties
// must not let a node cover or impersonate the portal chrome.
const SAFE_INLINE_STYLES = new Set([
  'background-color',
  'border-color',
  'border-radius',
  'border-style',
  'border-width',
  'color',
  'font-style',
  'font-weight',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'text-align',
  'text-decoration',
]);

// Markdown formatting plus inert HTML content. Interactive controls and form
// actions must never be supplied by a writable node in the portal's origin.
const NOTE_TAGS = [
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'cite',
  'code', 'dd', 'del', 'details', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li',
  'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'section', 'small', 'span', 'strong',
  'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul', 'var',
];
const NOTE_ATTRIBUTES = [
  'alt', 'checked', 'class', 'colspan', 'disabled', 'height', 'href',
  'open', 'rowspan', 'src', 'start', 'style', 'title', 'type', 'width',
];

function safeInlineStyle(raw: string, document: Document): string {
  const parsed = document.createElement('span').style;
  parsed.cssText = raw;
  const safe = document.createElement('span').style;
  for (let i = 0; i < parsed.length; i++) {
    const property = parsed.item(i);
    const value = parsed.getPropertyValue(property);
    if (
      SAFE_INLINE_STYLES.has(property) &&
      !parsed.getPropertyPriority(property) &&
      !/(?:url|var|expression)\s*\(/i.test(value)
    ) {
      safe.setProperty(property, value);
    }
  }
  return safe.cssText;
}

function safeClassNames(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).map((name) => {
    // Keep classes emitted by our Markdown extensions. Namespace authored
    // classes so they cannot activate the portal's Tailwind utility rules.
    if (name === 'wikilink' || name === WIKILINK_UNRESOLVED_CLASS || /^language-[\w-]+$/.test(name)) {
      return name;
    }
    return /^[\w-]+$/.test(name) ? `node-html-${name}` : '';
  }).filter(Boolean).join(' ');
}

let nodePurifier: ReturnType<typeof DOMPurify> | null = null;

function purifier(): ReturnType<typeof DOMPurify> {
  if (nodePurifier) return nodePurifier;
  const instance = DOMPurify(window);
  instance.addHook('uponSanitizeAttribute', (node, attribute) => {
    if (attribute.attrName === 'style') {
      attribute.attrValue = safeInlineStyle(attribute.attrValue, node.ownerDocument);
      attribute.keepAttr = Boolean(attribute.attrValue);
    } else if (attribute.attrName === 'class') {
      attribute.attrValue = safeClassNames(attribute.attrValue);
      attribute.keepAttr = Boolean(attribute.attrValue);
    }
  });
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName.toLowerCase() !== 'input') return;
    // Marked emits disabled checkboxes for GFM task lists. Treat authored
    // inputs the same way, with no submit-capable input type or name.
    node.setAttribute('type', 'checkbox');
    node.setAttribute('disabled', '');
    node.removeAttribute('src');
  });
  nodePurifier = instance;
  return instance;
}

export function createNodeMarkdownRenderer(
  MarkedClass: typeof Marked,
  wikilinks: WikilinkMap,
  strings: WikilinkStrings,
  options: { qualifiedOnly?: boolean } = {},
): Marked {
  return new MarkedClass({ extensions: [wikilinkExtension(wikilinks, strings, options)] });
}

export function renderNodeMarkdown(renderer: Marked, source: string): string {
  // Preserve authored HTML (including inline styles) while sanitizing every
  // output path before the node page inserts it with {@html}.
  return purifier().sanitize(renderer.parse(source, { async: false }) as string, {
    ALLOWED_TAGS: NOTE_TAGS,
    ALLOWED_ATTR: NOTE_ATTRIBUTES,
    // A stylesheet element can target the whole portal, outside node content.
    FORBID_TAGS: ['style'],
  });
}
