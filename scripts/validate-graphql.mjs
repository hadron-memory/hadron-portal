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
import { buildSchema, parse, validate, visit, specifiedRules, GraphQLError } from 'graphql';
import { declaredVariables, findCallerMismatches } from './check-graphql-callers.mjs';

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
    });
    declaration.lastIndex = i + 1;
  }
  return found;
}

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
 * Detected by WHERE the literal ended, which is the precondition itself rather
 * than one symptom of breaking it. A legitimate terminator is one of exactly
 * two shapes:
 *
 *   - a multi-line document closes with the backtick FIRST on its line (`` `; ``);
 *     all 166 in queries.ts do
 *   - a single-line document opens and closes on the same line
 *
 * Anything else means the literal ended in the MIDDLE of a body, which is a
 * nested backtick by definition — wherever it sits. That matters because the
 * `#` comment need not start the line: GraphQL comments run to end-of-line, so
 * `query A { me { id } } # mention `me`` terminates just as early, and the
 * truncated document left behind can still PARSE — so the validator would exit
 * 0 and the gate would be a phantom (Codex P2 on #757).
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
    const sameLineAsOpening = openLineStart === closeLineStart;
    const firstOnItsLine = text.slice(closeLineStart, i).trim() === '';

    if (!sameLineAsOpening && !firstOnItsLine) {
      const lineEnd = text.indexOf('\n', i);
      const line = text.slice(closeLineStart, lineEnd === -1 ? text.length : lineEnd);
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
    console.error("  Refresh it with 'pnpm gql:schema' (needs a ../hadron-server checkout).");
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
    // Never let a skipped call site read as a passing one.
    for (const skip of callers.skipped) console.warn(`… skipped ${skip}`);

    const docSummary = `${documents.length} documents, ${failures.length} invalid, ${naming.length} misnamed`;
    const callSummary = `${callers.checked} call sites, ${callers.failures.length} mismatched`;
    const summary = `${docSummary}; ${callSummary} (schema: ${relative(ROOT, schemaPath)})`;
    if (
      terminated.length > 0 ||
      failures.length > 0 ||
      naming.length > 0 ||
      callers.failures.length > 0
    ) {
      console.error(`\n✗ ${summary}`);
      if (terminated.length > 0) {
        console.error(
          '  A backtick inside a # comment ends the template literal — remove the backticks.',
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
    } else {
      console.log(`✓ ${summary}`);
    }
  }

  return terminated.length > 0 ||
    failures.length > 0 ||
    naming.length > 0 ||
    callers.failures.length > 0
    ? 1
    : 0;
}

// Only act as a CLI when executed directly, so the test can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
