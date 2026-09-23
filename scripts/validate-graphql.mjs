#!/usr/bin/env node
// Build-time validation for the portal's GraphQL operations (#681).
//
// The portal sends raw GraphQL strings through graphql-request — there is no
// codegen, so a server-side rename fails at RUNTIME, on the one flow that uses
// it, instead of in CI. That is how `runTask(urn:)` stayed broken from
// hadron-server#542 until #681, and how `addToMyMemories` survived its own
// removal in hadron-server#771.
//
// This script closes that hole the same way hadron-cli's genqlient step does:
// extract every `/* GraphQL */` template literal, resolve the fragment
// interpolations, and validate each document against a committed SDL snapshot.
//
//   node scripts/validate-graphql.mjs                    # vs schema/schema.graphql
//   node scripts/validate-graphql.mjs --schema <path>    # vs some other SDL
//   node scripts/validate-graphql.mjs --json             # machine-readable report
//
// Exits 0 when every document validates, 1 otherwise. The extraction and
// validation helpers are exported so validate-graphql.test.ts can prove this
// gate still FAILS on a drifted operation — a validator that silently passes
// everything is worse than no validator.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { buildSchema, parse, validate, visit, specifiedRules, GraphQLError } from 'graphql';
import { declaredVariables, findCallerMismatches } from './check-graphql-callers.mjs';
import { findDoorViolations } from './check-node-write-doors.mjs';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC_DIR = join(ROOT, 'src');
const DEFAULT_SCHEMA = join(ROOT, 'schema', 'schema.graphql');

// A fragment-only const (MEMORY_FIELDS, ORG_FIELDS, …) is a legitimate document
// on its own, but NoUnusedFragments would reject it for not being spread into
// an operation. Every other rule still applies, so a bad field inside a
// fragment is still caught — both standalone and at each interpolation site.
const RULES = specifiedRules.filter((rule) => rule.name !== 'NoUnusedFragmentsRule');

/** Every `.ts`/`.svelte` file under `dir`, minus build noise. */
export function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.svelte-kit') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|svelte)$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Pull every `const NAME = /* GraphQL *\/ `…`` binding out of one file.
 *
 * The bodies contain `${FRAGMENT}` interpolations but never a nested backtick,
 * so scanning to the next unescaped backtick terminates the literal correctly.
 */
export function extractDocuments(file, text) {
  const found = [];
  const declaration = /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*\/\*\s*GraphQL\s*\*\/\s*`/g;
  let match;
  while ((match = declaration.exec(text)) !== null) {
    const bodyStart = declaration.lastIndex;
    let i = bodyStart;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i] === '`') break;
      else i += 1;
    }
    if (i >= text.length) {
      throw new Error(`${file}: unterminated GraphQL template literal for ${match[1]}`);
    }
    found.push({
      name: match[1],
      body: text.slice(bodyStart, i),
      file,
      // 1-indexed line of the `const` keyword, so the report is clickable.
      line: text.slice(0, match.index).split('\n').length,
      // Character offset of the body's first character — just past the opening
      // backtick. It identifies this OCCURRENCE, which the body text cannot:
      // two documents may be character-identical (@copilot on #881).
      bodyStart,
    });
    declaration.lastIndex = i + 1;
  }
  return found;
}

/**
 * The SHAPE half of a legitimate terminator (see below): the backtick, then
 * only what can END this declaration — `;`, a `,` continuing a multi-declarator
 * `const`, or nothing (ASI) — plus an optional trailing `//` comment. A real
 * close ends its expression there; prose carries on past it.
 *
 * COUPLED TO `declaration` below, which matches `const NAME = /* GraphQL *\/`
 * and nothing else. That is why `)`, `]` and `}` are absent: no tail reaching
 * this regex can contain them, because the form that would produce one — a
 * document passed as a call argument, `gql(/* GraphQL *\/ `…`)` — is never
 * scanned in the first place. An earlier draft allowed them, "for robustness",
 * with a test asserting `` `); `` is accepted; both review bots caught that the
 * fixture used the call form and so was never scanned at all, making the test
 * vacuous and the permissiveness invisible. Widening `declaration` means
 * widening this too, in the same commit.
 */
const TERMINATOR_TAIL = /^`[;,\s]*(?:\/\/.*)?$/;

/**
 * Enforce the precondition `extractDocuments` above states and cannot check for
 * itself: a `/* GraphQL *\/` body never contains a nested backtick (#751).
 *
 * A bare backtick anywhere in a body — most often inside a `#` GraphQL comment,
 * where it looks like ordinary prose formatting — TERMINATES the tagged
 * template literal. What follows is parsed
 * as TypeScript, so esbuild reports a syntax error on the NEXT GraphQL line,
 * naming a field as though it were a statement, and nothing anywhere says
 * "unterminated template literal". `queries.ts` is imported by nearly every
 * loader and action, so every route test fails to transform at once; the wall
 * of unrelated red is the only real tell, and only if you already know it.
 *
 * Detected by asking whether the backtick that ended the literal is one that
 * legitimately COULD have, which is the precondition itself rather than one
 * symptom of breaking it. A legitimate terminator has to satisfy both halves:
 *
 *   - POSITION — first on its line (a multi-line document, `` `; ``), or on the
 *     line the literal opened (a single-line document)
 *   - SHAPE — the line ENDS there: the backtick, then only closing punctuation
 *     and an optional trailing `//` comment. All 180 documents under src/ close
 *     with exactly `` `; ``
 *
 * Anything else means the literal ended in the MIDDLE of a body, which is a
 * nested backtick by definition — wherever it sits. That matters because the
 * `#` comment need not start the line: GraphQL comments run to end-of-line, so
 * `query A { me { id } } # mention `me`` terminates just as early, and the
 * truncated document left behind can still PARSE — so the validator would exit
 * 0 and the gate would be a phantom (Codex P2 on #757).
 *
 * POSITION alone was the whole test until SHAPE was added beside it, and it let
 * through exactly that phantom in two shapes — measured, not reasoned: the gate
 * exited 0 on source that does not compile. A stray backtick FIRST on its line
 * (a wrapped `#` comment continuing with a markdown code span) was read as the
 * close, and a stray anywhere on a single-line document's one line was accepted
 * by the same-line rule. Both printed a tick. A false ✓ is worse than silence,
 * because this gate exists only to translate a baffling esbuild error into a
 * clear one — a tick spends the reader's attention steering them away from the
 * defect. Reported by @Dara from hadron-server#1076, where the port hit it too.
 *
 * SHAPE does not extend to a real `` `.trim() `` or `` ` as const ``
 * continuation, and deliberately: teaching a text scanner expression syntax
 * gives prose one more shape to imitate, and that failure is a silent false
 * negative — the only failure this gate exists to prevent. There are none in
 * the tree; if one is ever written, this fires LOUDLY on valid source and the
 * message says what a terminator may look like, which is the cheap direction.
 *
 * Written after the trap bit twice in one session (PRs #749 and #752), the
 * second time AFTER reading the finding that documents it and repairing that
 * finding's review trigger. A review node fires at review time; this fails at
 * authoring time, which is when the cost is paid.
 */
export function findCommentTerminatedDocuments(file, text) {
  const offenders = [];
  const declaration = /(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*\/\*\s*GraphQL\s*\*\/\s*`/g;
  let match;
  while ((match = declaration.exec(text)) !== null) {
    const openIndex = declaration.lastIndex - 1;
    let i = declaration.lastIndex;
    while (i < text.length) {
      if (text[i] === '\\') i += 2;
      else if (text[i] === '`') break;
      else i += 1;
    }
    if (i >= text.length) break; // unterminated; extractDocuments reports it

    const openLineStart = text.lastIndexOf('\n', openIndex) + 1;
    const closeLineStart = text.lastIndexOf('\n', i) + 1;
    const lineEnd = text.indexOf('\n', i);
    const line = text.slice(closeLineStart, lineEnd === -1 ? text.length : lineEnd);

    const sameLineAsOpening = openLineStart === closeLineStart;
    const firstOnItsLine = text.slice(closeLineStart, i).trim() === '';
    const positionCouldClose = sameLineAsOpening || firstOnItsLine;
    // The rest of the line, from this backtick on. A real terminator ends the
    // expression here; prose carries on past it.
    const shapeCouldClose = TERMINATOR_TAIL.test(text.slice(i, lineEnd === -1 ? text.length : lineEnd));

    if (!positionCouldClose || !shapeCouldClose) {
      const inComment = line.slice(0, i - closeLineStart).includes('#');
      offenders.push({
        name: match[1],
        file,
        line: text.slice(0, i).split('\n').length,
        errors: [
          inComment
            ? 'a backtick in this # comment ends the GraphQL template literal early —'
            : 'a backtick here ends the GraphQL template literal early —',
          'the build then fails on the NEXT line with a TypeScript error that names',
          'the wrong thing. Write the identifier as plain prose, without backticks.',
          // Name the other reading. A backtick the POSITION rule would have
          // accepted looks like a real terminator, so "remove the backticks"
          // alone reads as advice to delete one — the confidently-wrong
          // instruction hadron-server#1085 had to repair.
          //
          // Stated as what was OBSERVED, per
          // `hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee`.
          // It does NOT say the document is single-line (this scan
          // has not found the real close, so it cannot know) and does not call
          // the rest of the line prose (it may be a `.trim()` continuation this
          // check deliberately refuses).
          ...(positionCouldClose
            ? [
                'This backtick sits where a terminator could sit — first on its line, or on the',
                'line the document opened — so it resembles a real close. What rules it out is',
                'the rest of the line: a terminator ends its line, and this one does not.',
              ]
            : []),
          `    ${line.trim()}`,
        ],
      });
    }
    declaration.lastIndex = i + 1;
  }
  return offenders;
}

/** Every comment-terminated document across `src/`. */
export function collectCommentTerminated(srcDir = SRC_DIR) {
  return sourceFiles(srcDir).flatMap((file) =>
    findCommentTerminatedDocuments(relative(ROOT, file), readFileSync(file, 'utf8')),
  );
}

/**
 * Every GraphQL document declared WITHOUT the `/* GraphQL *\/` marker (#872).
 *
 * ## Why an unmarked document is invisible to everything
 *
 * `extractDocuments` finds documents by that marker. A `const` bound to a
 * template literal without one is therefore not extracted — so it is not
 * validated against the schema, its `$variables` are never cross-checked
 * against its callers (`check-graphql-callers` cannot resolve a document it
 * does not know), and the arg-naming rule never sees it.
 *
 * Nothing about that is loud. `gql:validate` reported "200 documents, 0
 * invalid" while EIGHT sat outside it — a count that reads as complete and was
 * eight short. Marking them raised it to 208, and brought call sites that had
 * never been checked by anything under variable checking.
 *
 * The corpus is **207** today, not 208: the same PR deleted the conversation
 * editor's local `UPDATE` document. Both numbers are real and neither is the
 * other's correction — which is exactly why a count quoted from mid-stack
 * reads as a measurement of the finished work. Say which commit a number came
 * from, or quote the current one.
 *
 * This gate exists because #681 exists: a server-side rename of an unmarked
 * document's field fails at RUNTIME, on the one flow that uses it. That is how
 * `runTask(urn:)` and `addToMyMemories` stayed broken in production for months,
 * and marking the eight by hand would leave a ninth free to appear next quarter.
 *
 * ## The predicate
 *
 * ANY template literal whose text PARSES as GraphQL and declares an operation
 * or a fragment, wherever it appears. Parsing rather than pattern-matching, so
 * a string that merely mentions the word `query` is not a document — and
 * matched on the AST, so a comment ABOUT a document is not one either.
 *
 * **It deliberately does not ask how the document is DECLARED.** The first cut
 * matched a `const` initialiser, which is the shape the eight known offenders
 * happened to have — and `client.request(`query …`)` written inline, the most
 * natural way to introduce a ninth, walked straight past it. Six shapes did:
 * an inline call argument, an object-literal property, a class property, a
 * function return, an export-default and an arrow body. None were live in
 * `src/` when this was widened, so nothing had to be marked to make it pass;
 * the hole was latent, which is the only reason it stayed comfortable.
 *
 * That is `hrn:node:hadronmemory.com:hadron-portal:review:gate-the-import-not-the-call-site`
 * arriving from a third direction: a gate keyed on what a thing is NAMED or
 * SHAPED LIKE, rather than on what it DOES, is defeated by writing the same
 * thing another way. A document is a document because it parses as one.
 *
 * ## The marker is not the test — COLLECTION is (#880)
 *
 * Widening the violation half without widening the exemption half built a trap.
 * `extractDocuments` reads `const NAME = /* GraphQL *\/ `…`` and nothing else,
 * so a marker on an inline document made the warning disappear while the
 * document stayed invisible to the schema check, the caller cross-check and the
 * naming rule. The gate pointed at a real problem and then blessed a fix that
 * fixed nothing — worse than the silence it replaced, because silence at least
 * did not mislead.
 *
 * So the question this asks is **"did the extractor collect it?"**, not "is
 * there a marker?" — and it asks by RUNNING the extractor rather than by
 * re-deriving its rule here. Two implementations of one rule is the defect this
 * gate's own sibling check was written about, and a second copy would drift the
 * moment either moved. Widen `extractDocuments` and this accepts the new
 * positions with no edit.
 *
 * A document the extractor cannot read is reported either way; `marked` says
 * which remedy applies, because "add the marker" is wrong advice for a shape no
 * marker can rescue.
 *
 * Interpolations are dropped before parsing rather than resolved: this repo's
 * idiom is `${FRAGMENT}` prepended to an operation, and removing it leaves the
 * operation parseable. Resolving them is `resolveInterpolations`' job, and it
 * needs the extraction this check is about to have already happened.
 */
export function findUnmarkedDocuments(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  // The extractor defines the corpus, so it is the authority on whether a
  // document is in it — asked by OCCURRENCE, not by text.
  //
  // Body text is not an identity. Two documents can be character-identical, and
  // the obvious way to produce that pair is the very mistake this gate is for:
  // copy a `const` document into an inline call and leave both. Matching on
  // bodies would find the collected one and clear the uncollected one — the
  // same false exemption #880 is about, one level down (@copilot on #881).
  //
  // `bodyStart` is the offset just past the opening backtick; a template
  // literal node's start + 1 is the same position. Two parsers, one offset.
  const collected = new Set(extractDocuments(file, text).map((doc) => doc.bodyStart));

  const visit = (node) => {
    let body = null;
    if (ts.isNoSubstitutionTemplateLiteral(node)) body = node.text;
    else if (ts.isTemplateExpression(node)) {
      body = node.head.text + node.templateSpans.map((span) => span.literal.text).join('');
    }
    if (body !== null && body.trim() !== '' && isGraphQLDocument(body)) {
      if (!collected.has(node.getStart(source) + 1)) {
        // The marker sits in the trivia immediately before the backtick — which
        // is where it lands in every position, not just after a `=`.
        const trivia = text.slice(node.getFullStart(), node.getStart(source));
        // A named binding reports its name; an inline document has none, so it
        // is reported by position. Reporting it namelessly is the point — the
        // shapes without a name are exactly the ones that used to escape.
        const parent = node.parent;
        const name = parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
          ? parent.name.text
          : parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)
            ? parent.name.text
            : '(inline)';
        found.push({
          name,
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          marked: /\/\*\s*GraphQL\s*\*\//.test(trivia),
          // Would adding the marker actually get this collected? Asked the same
          // way as everything else here — by running the extractor on the text
          // that change would produce, rather than by re-deriving its rule.
          //
          // It matters because "add the marker" is the advice for the unmarked
          // case, and on an unmarked INLINE document that advice is wrong: the
          // author follows it and the document is still uncollected. That is
          // #880 again, in the diagnostic rather than in the logic — a gate
          // that prints a remedy which does not remedy (@copilot on #881).
          markerWouldSuffice: markerWouldCollect(file, text, node.getStart(source)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Would inserting the marker here get this literal COLLECTED?
 *
 * Answered by asking the extractor about the text that edit would produce, so
 * the extractor stays the single authority on its own rule. Re-deriving "a
 * `const` binding is the supported shape" as a second predicate is how the two
 * drift apart, which is the defect this whole check is about.
 */
function markerWouldCollect(file, text, backtick) {
  const MARKER = '/* GraphQL */ ';
  const patched = text.slice(0, backtick) + MARKER + text.slice(backtick);
  try {
    return extractDocuments(file, patched).some(
      (doc) => doc.bodyStart === backtick + MARKER.length + 1,
    );
  } catch {
    // An unterminated literal elsewhere in the file — the extractor's own
    // error, which the caller surfaces. Say nothing rather than guess.
    return false;
  }
}

/** Does this text parse as GraphQL AND declare an operation or fragment? */
function isGraphQLDocument(body) {
  let ast;
  try {
    ast = parse(body);
  } catch {
    return false;
  }
  return ast.definitions.some(
    (d) => d.kind === 'OperationDefinition' || d.kind === 'FragmentDefinition',
  );
}

/**
 * Every unmarked document across `src/`, plus the count of MARKED ones.
 *
 * The marked count is the anti-vacuity floor. Without it, breaking the walk —
 * or the marker regex — leaves this check reporting "nothing unmarked" forever,
 * which is indistinguishable from a clean tree.
 *
 * TEST files are skipped, and for TWO separate reasons that this `continue`
 * happens to serve at once — worth stating, because only one of them was
 * written down and they could later need to move apart:
 *
 * 1. **Out of the floor**, because a gate's own fixtures use the construct
 *    densely and a floor its test suite can satisfy is not a floor
 *    (hrn:node:hadronmemory.com:hadron-portal:review:a-floor-must-not-count-the-gates-own-tests).
 * 2. **Out of the scan**, because a deliberately-unmarked document is a valid
 *    thing for a test to contain. `layout.server.test.ts` builds one to prove
 *    a depth check can actually trip on the shape it forbids
 *    (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
 *    Marking it to satisfy this gate would enrol a fixture into the real
 *    corpus and validate it as a shipped document, which is worse than the
 *    thing being prevented.
 *
 * Measured rather than assumed: that fixture is the ONLY unmarked document in
 * all 233 test files, so this skip is currently hiding exactly one thing, and
 * it is the one it should hide.
 */
export function collectUnmarkedDocuments(srcDir = SRC_DIR) {
  const unmarked = [];
  let marked = 0;
  for (const file of sourceFiles(srcDir)) {
    const rel = relative(ROOT, file);
    if (/\.(client\.)?test\.[cm]?[jt]sx?$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    marked += extractDocuments(rel, text).length;
    unmarked.push(...findUnmarkedDocuments(rel, text));
  }
  return { unmarked, marked };
}

/**
 * The floor. The repository sits at 207 marked documents (excluding tests, as
 * the collector above does); below this the walk is not seeing the corpus it
 * claims to. A FLOOR, not an exact count — adding a document must not require
 * editing a number to permit it, which is also why the drift between this
 * prose and the real count is harmless where an exact assertion would not be.
 */
export const MIN_MARKED_DOCUMENTS = 200;

/**
 * Splice `${FRAGMENT}` references in, recursively, so an operation is validated
 * together with the fragments it actually spreads. Interpolations that name
 * something we did not extract, or that form a cycle, are reported rather than
 * silently producing an unparseable document.
 */
export function resolveInterpolations(doc, byName, seen = new Set()) {
  if (seen.has(doc.name)) {
    throw new Error(`circular fragment interpolation through ${[...seen, doc.name].join(' -> ')}`);
  }
  const nextSeen = new Set(seen).add(doc.name);
  return doc.body.replace(/\$\{\s*([A-Za-z0-9_$]+)\s*\}/g, (_whole, ref) => {
    const target = byName.get(ref);
    if (!target) {
      throw new Error(`${doc.name} interpolates \${${ref}}, which is not a GraphQL document`);
    }
    return resolveInterpolations(target, byName, nextSeen);
  });
}

/** Validate every document against `schema`; returns only the failures. */
export function findInvalid(schema, documents) {
  const byName = new Map(documents.map((doc) => [doc.name, doc]));
  const failures = [];
  for (const doc of documents) {
    let errors;
    try {
      errors = validate(schema, parse(resolveInterpolations(doc, byName)), RULES);
    } catch (err) {
      // A parse failure or an unresolvable interpolation is just as fatal as a
      // validation error; report it in the same shape.
      errors = [err instanceof GraphQLError ? err : new GraphQLError(err.message)];
    }
    if (errors.length > 0) failures.push({ ...doc, errors: errors.map((e) => e.message) });
  }
  return failures;
}

/**
 * Enforce that an argument and the $variable filling it share a name —
 * `appKeys(appRef: $appRef)`, never `appKeys(appRef: $appId)`.
 *
 * The portal drifted into two different spellings of this (#519 renamed
 * variables with their arguments, #682 deliberately did not), which left the
 * file inconsistent and its explanatory comment wrong twice. The sweep that
 * unified it is only durable if the convention is checked, so: checked.
 *
 * The one shape this cannot express is a single variable filling two
 * differently-named arguments; there are none today, and the error says so.
 */
export function findArgVariableMismatches(documents, resolve) {
  const failures = [];
  for (const doc of documents) {
    let ast;
    try {
      ast = parse(resolve(doc));
    } catch {
      continue; // findInvalid reports the parse failure
    }
    const errors = [];
    visit(ast, {
      OperationDefinition(op) {
        visit(op, {
          Argument(arg) {
            if (arg.value.kind !== 'Variable') return;
            const a = arg.name.value;
            const v = arg.value.name.value;
            if (a !== v) {
              errors.push(
                `${op.name?.value ?? '(anon)'} fills "${a}:" with $${v} — name the variable $${a} ` +
                  '(or, if one variable must fill two differently-named arguments, split it)',
              );
            }
          },
        });
      },
    });
    if (errors.length > 0) failures.push({ ...doc, errors });
  }
  return failures;
}

/** Every GraphQL document declared under `src/`. */
export function collectPortalDocuments(srcDir = SRC_DIR) {
  const documents = [];
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('GraphQL */')) continue;
    documents.push(...extractDocuments(relative(ROOT, file), text));
  }
  return documents;
}

function main(argv) {
  const asJson = argv.includes('--json');
  const schemaFlag = argv.indexOf('--schema');
  // `--schema` with no path (or followed by another flag) would otherwise throw
  // inside resolve() before printing anything useful — reported on #681 review.
  if (schemaFlag !== -1) {
    const value = argv[schemaFlag + 1];
    if (value === undefined || value.startsWith('-')) {
      console.error('✗ --schema needs a path to an SDL file, e.g. --schema schema/schema.graphql');
      return 1;
    }
  }
  const schemaPath = schemaFlag === -1 ? DEFAULT_SCHEMA : resolve(argv[schemaFlag + 1]);

  let schema;
  try {
    schema = buildSchema(readFileSync(schemaPath, 'utf8'));
  } catch (err) {
    console.error(`✗ could not read the SDL at ${relative(ROOT, schemaPath)}: ${err.message}`);
    console.error("  Refresh it with 'pnpm gql:schema' (reads a hadron-server git clone; see --help).");
    return 1;
  }

  const documents = collectPortalDocuments();
  const byName = new Map(documents.map((doc) => [doc.name, doc]));
  const failures = findInvalid(schema, documents);

  // Caller-side half: a $variable is internal to the document, so a rename
  // keeps the document valid while every stale caller breaks at runtime. See
  // check-graphql-callers.mjs.
  const declared = declaredVariables(documents, (doc) => resolveInterpolations(doc, byName));
  const callers = findCallerMismatches(sourceFiles(SRC_DIR), declared, ROOT);
  const naming = findArgVariableMismatches(documents, (doc) => resolveInterpolations(doc, byName));
  // #751: the precondition extractDocuments assumes — no nested backtick in a
  // GraphQL body. Checked FIRST in the report because a comment-terminated
  // document truncates everything after it, so the other checks are reasoning
  // about a document the author never wrote.
  const terminated = collectCommentTerminated();
  // #872: a document with no `/* GraphQL */` marker is extracted by nothing, so
  // every check above is silently blind to it — including the document COUNT,
  // which is what makes the blindness look like health.
  const { unmarked, marked } = collectUnmarkedDocuments();
  const markedShortfall =
    marked < MIN_MARKED_DOCUMENTS
      ? [
          `the walk found ${marked} marked documents, expected at least ` +
            `${MIN_MARKED_DOCUMENTS} — it is not seeing the corpus, which is not ` +
            'the same as the corpus being clean.',
        ]
      : [];
  // #868: every node-update write must go through the kind's door. Checked here
  // rather than as its own workflow because it needs the same document map, and
  // because a governed refusal IS a schema-contract failure — it is the server
  // telling the portal it called the wrong operation.
  const doors = findDoorViolations(sourceFiles(SRC_DIR), ROOT, (name) => {
    const doc = byName.get(name);
    return doc === undefined ? undefined : resolveInterpolations(doc, byName);
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          schema: relative(ROOT, schemaPath),
          documents: documents.length,
          invalid: failures.length,
          failures: failures.map(({ name, file, line, errors }) => ({ name, file, line, errors })),
          callSites: callers.checked,
          callerMismatches: callers.failures.length,
          callerFailures: callers.failures,
          callerSkipped: callers.skipped,
          commentTerminated: terminated.length,
          commentTerminatedFailures: terminated.map(({ name, file, line }) => ({ name, file, line })),
          namingMismatches: naming.length,
          namingFailures: naming.map(({ name, file, line, errors }) => ({ name, file, line, errors })),
          // #868. `routedNodeWrites` is reported even when it is healthy: the
          // count is what distinguishes "no violations" from "nothing looked at".
          markedDocuments: marked,
          unmarkedDocuments: unmarked.length,
          unmarkedFailures: unmarked.map(({ name, file, line, marked, markerWouldSuffice }) =>
            ({ name, file, line, marked, markerWouldSuffice })),
          routedNodeWrites: doors.routed,
          doorViolations: doors.failures.length,
          doorFailures: doors.failures,
        },
        null,
        2,
      ),
    );
  } else {
    for (const failure of [...terminated, ...failures, ...naming, ...callers.failures]) {
      console.error(`✗ ${failure.file}:${failure.line}  ${failure.name}`);
      for (const message of failure.errors) console.error(`    ${message}`);
    }
    for (const doc of unmarked) {
      console.error(`✗ ${doc.file}:${doc.line}  ${doc.name}`);
      // The remedy is chosen by what would actually COLLECT the document, not
      // by whether a marker happens to be present. On an unmarked document in
      // an unsupported position both are wrong-if-swapped: "add the marker"
      // leaves it uncollected (#880's own lesson, in the diagnostic).
      console.error(
        doc.markerWouldSuffice
          ? '    a GraphQL document with no /* GraphQL */ marker is extracted by ' +
              'nothing — not the schema check, not the caller check, not the naming ' +
              'rule. Add the marker (#872).'
          : '    extractDocuments cannot read a document here' +
              (doc.marked ? ', marker or not' : '') +
              ', so the schema check, the caller check and the naming rule never ' +
              'see it. Bind it to a `const NAME = /* GraphQL */ `…`` (#880).',
      );
    }
    for (const violation of [...markedShortfall, ...doors.failures]) console.error(`✗ ${violation}`);
    // Never let a skipped call site read as a passing one.
    for (const skip of callers.skipped) console.warn(`… skipped ${skip}`);

    const docSummary = `${documents.length} documents, ${failures.length} invalid, ${naming.length} misnamed, ${unmarked.length} unmarked`;
    const callSummary = `${callers.checked} call sites, ${callers.failures.length} mismatched`;
    // The routed count is printed on the PASSING line too — a gate that only
    // ever says "clean" cannot be told apart from one that stopped looking.
    const doorSummary = `${doors.routed} node writes routed through the kind door`;
    const summary = `${docSummary}; ${callSummary}; ${doorSummary} (schema: ${relative(ROOT, schemaPath)})`;
    if (
      terminated.length > 0 ||
      failures.length > 0 ||
      naming.length > 0 ||
      callers.failures.length > 0 ||
      doors.failures.length > 0 ||
      unmarked.length > 0 ||
      markedShortfall.length > 0
    ) {
      console.error(`\n✗ ${summary}`);
      if (terminated.length > 0) {
        console.error(
          '  A backtick inside a GraphQL body ends the template literal — remove the backticks.',
        );
      }
      if (failures.length > 0) {
        console.error(
          '  If the server changed on purpose, run "pnpm gql:schema" and reconcile the operations.',
        );
      }
      if (callers.failures.length > 0) {
        console.error("  A caller's variable keys must match the operation's $variables.");
      }
      if (unmarked.length > 0) {
        console.error(
          '  A document the extractor cannot collect is validated by nothing. ' +
            'The marker is necessary and not sufficient: it must sit on a ' +
            '`const` binding, which is the only shape extractDocuments reads.',
        );
      }
      if (doors.failures.length > 0) {
        console.error(
          '  A node update must pick its mutation with nodeUpdateDocument() — the ' +
            'server refuses the generic door for any governed node (server #1201).',
        );
      }
    } else {
      console.log(`✓ ${summary}`);
    }
  }

  return terminated.length > 0 ||
    failures.length > 0 ||
    naming.length > 0 ||
    callers.failures.length > 0 ||
    doors.failures.length > 0 ||
    unmarked.length > 0 ||
    markedShortfall.length > 0
    ? 1
    : 0;
}

// Only act as a CLI when executed directly, so the test can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
