/**
 * Bidirectional transform between the structured UI tree (UiCondition)
 * and JSONLogic JSON. The portal builds and edits the UI tree;
 * `serialize()` is called on save, `deserialize()` on load.
 *
 * Round-trip guarantee (SC-003): any UI tree that goes through
 * serialize ⟶ deserialize comes back structurally equal.
 *
 * Asymmetric guarantee: not every valid JSONLogic value can be
 * represented by the UI (arithmetic, nested operator expressions,
 * non-curated operators). `deserialize()` returns
 * `{ ok: false, reason }` for those, signaling the caller to drop
 * the user into a raw-JSON view.
 */

import type {
  UiClause,
  UiCondition,
  UiGroup,
  UiOperator,
  UiValue,
} from './types.js';

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

export function serialize(ui: UiCondition): unknown {
  if (ui === null) return null;
  return serializeGroupOrSingle(ui);
}

function serializeGroupOrSingle(group: UiGroup): unknown {
  const children = group.children.map((c) =>
    c.kind === 'clause' ? serializeClause(c) : serializeGroupOrSingle(c),
  );
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { [group.combinator]: children };
}

function serializeClause(clause: UiClause): unknown {
  if (clause.operator === 'missing') {
    return { missing: [clause.field] };
  }
  const lhs = { var: clause.field };
  const rhs = serializeValue(clause.value, clause.operator);
  return { [clause.operator]: [lhs, rhs] };
}

function serializeValue(value: UiValue | undefined, operator: UiOperator): unknown {
  if (!value) return null;
  if (value.kind === 'variable') return { var: value.path };
  // literal — try to coerce the user's text to the right shape
  if (operator === 'in') {
    // For `in`, comma-separated literals are a list of strings/numbers.
    return value.literal
      .split(',')
      .map((s) => parseLiteral(s.trim()));
  }
  return parseLiteral(value.literal);
}

function parseLiteral(s: string): unknown {
  if (s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '') return '';
  // Numeric? Allow integers and floats, including negative.
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

export type DeserializeResult =
  | { ok: true; ui: UiCondition }
  | { ok: false; reason: string };

const UI_OPERATORS: ReadonlySet<string> = new Set([
  '==', '!=', '<', '<=', '>', '>=', 'in', 'missing',
]);

export function deserialize(json: unknown): DeserializeResult {
  if (json === null || json === undefined) return { ok: true, ui: null };
  // Top-level expressions are wrapped in an `and` group with a single
  // child unless they are themselves an `and`/`or` operator node.
  const result = deserializeNode(json);
  if (!result.ok) return result;
  if (result.value.kind === 'group') {
    return { ok: true, ui: result.value };
  }
  return {
    ok: true,
    ui: { kind: 'group', combinator: 'and', children: [result.value] },
  };
}

type NodeResult =
  | { ok: true; value: UiClause | UiGroup }
  | { ok: false; reason: string };

function deserializeNode(node: unknown): NodeResult {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return { ok: false, reason: `expected an operator node, got ${describe(node)}` };
  }
  const keys = Object.keys(node);
  if (keys.length !== 1) {
    return { ok: false, reason: 'JSONLogic operator nodes must have exactly one key' };
  }
  const op = keys[0];
  const args = (node as Record<string, unknown>)[op];

  if (op === 'and' || op === 'or') {
    if (!Array.isArray(args)) {
      return { ok: false, reason: `${op} expects an array of children` };
    }
    const children: Array<UiClause | UiGroup> = [];
    for (const child of args) {
      const r = deserializeNode(child);
      if (!r.ok) return r;
      children.push(r.value);
    }
    return {
      ok: true,
      value: { kind: 'group', combinator: op, children },
    };
  }

  if (!UI_OPERATORS.has(op)) {
    return {
      ok: false,
      reason: `operator '${op}' is not supported by the structured builder; use raw JSON`,
    };
  }

  if (op === 'missing') {
    if (!Array.isArray(args) || args.length !== 1 || typeof args[0] !== 'string') {
      return {
        ok: false,
        reason: 'the structured builder only supports `missing` with one field path',
      };
    }
    return {
      ok: true,
      value: { kind: 'clause', field: args[0], operator: 'missing' },
    };
  }

  // Comparison or `in`: expect [lhs, rhs] where lhs is { var: <path> }.
  if (!Array.isArray(args) || args.length !== 2) {
    return {
      ok: false,
      reason: `${op} expects [lhs, rhs]`,
    };
  }
  const lhs = args[0];
  const rhs = args[1];
  const field = parseVarRef(lhs);
  if (field === null) {
    return {
      ok: false,
      reason: `the structured builder requires the left-hand side to be { var: <path> }`,
    };
  }
  const value = parseValue(rhs, op as UiOperator);
  if (value === 'unsupported') {
    return {
      ok: false,
      reason: 'unsupported value shape; use raw JSON for nested expressions or arithmetic',
    };
  }
  return {
    ok: true,
    value: {
      kind: 'clause',
      field,
      operator: op as UiOperator,
      value,
    },
  };
}

function parseVarRef(node: unknown): string | null {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return null;
  const keys = Object.keys(node);
  if (keys.length !== 1 || keys[0] !== 'var') return null;
  const v = (node as Record<string, unknown>).var;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return null;
}

function parseValue(node: unknown, op: UiOperator): UiValue | 'unsupported' {
  // For `in`, value is an array of literals.
  if (op === 'in') {
    if (!Array.isArray(node)) return 'unsupported';
    if (!node.every((x) => isLiteral(x))) return 'unsupported';
    return {
      kind: 'literal',
      literal: node.map((x) => stringifyLiteral(x)).join(', '),
    };
  }
  // Variable reference?
  const asVar = parseVarRef(node);
  if (asVar !== null) {
    return { kind: 'variable', path: asVar };
  }
  // Plain literal?
  if (isLiteral(node)) {
    return { kind: 'literal', literal: stringifyLiteral(node) };
  }
  return 'unsupported';
}

function isLiteral(x: unknown): x is string | number | boolean | null {
  return (
    x === null ||
    typeof x === 'string' ||
    typeof x === 'number' ||
    typeof x === 'boolean'
  );
}

function stringifyLiteral(x: string | number | boolean | null): string {
  if (x === null) return 'null';
  if (typeof x === 'boolean') return x ? 'true' : 'false';
  return String(x);
}

function describe(x: unknown): string {
  if (x === null) return 'null';
  if (Array.isArray(x)) return 'array';
  return typeof x;
}
