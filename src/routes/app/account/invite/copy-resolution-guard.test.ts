import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/routes/app/account/invite/+page.svelte', 'utf8');

function isComparison(source: ts.SourceFile, expression: ts.Expression, left: string, right: string) {
  if (!ts.isBinaryExpression(expression) || expression.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return false;
  const operands = [expression.left.getText(source), expression.right.getText(source)];
  return operands.includes(left) && operands.includes(right);
}

function hasGuard(source: ts.SourceFile, expression: ts.Expression, left: string, right: string): boolean {
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return hasGuard(source, expression.left, left, right) || hasGuard(source, expression.right, left, right);
  }
  return isComparison(source, expression, left, right);
}

function assignedCopyState(source: ts.SourceFile, statement: ts.Statement) {
  if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) return null;
  const assignment = statement.expression;
  if (assignment.operatorToken.kind !== ts.SyntaxKind.EqualsToken || assignment.left.getText(source) !== 'copyState' || !ts.isStringLiteral(assignment.right)) return null;
  return assignment.right.text;
}

function resolutionStates(text: string) {
  const scriptStart = text.indexOf('<script lang="ts">');
  const bodyStart = text.indexOf('>', scriptStart) + 1;
  const bodyEnd = text.indexOf('</script>', bodyStart);
  if (scriptStart < 0 || bodyStart === 0 || bodyEnd < 0) throw new Error('Invite page script is missing');
  const source = ts.createSourceFile('invite-page-script.ts', text.slice(bodyStart, bodyEnd), ts.ScriptTarget.Latest, true);
  const states: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node)) {
      const state = assignedCopyState(source, node.thenStatement);
      if (state && hasGuard(source, node.expression, 'attempt', 'copyAttempt') && hasGuard(source, node.expression, 'inviteUrl', 'url')) states.push(state);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return states;
}

function withoutIdentity(state: 'copied' | 'failed') {
  const original = `if (attempt === copyAttempt && inviteUrl === url) copyState = '${state}';`;
  expect(page).toContain(original);
  return page.replace(original, `if (attempt === copyAttempt) copyState = '${state}';`);
}

describe('invite clipboard resolution attribution (#1883)', () => {
  it('keeps URL identity in both the success and failure guards', () => {
    // The Chromium replacement case already changes the URL while a write is
    // pending and asserts that its stale completion publishes no feedback.
    // Its copyAttempt invalidation also masks deletion of inviteUrl === url,
    // so pin that independent half directly in BOTH resolution branches.
    expect(resolutionStates(page)).toEqual(['copied', 'failed']);
  });

  it.each([
    { removed: 'copied', remaining: ['failed'] },
    { removed: 'failed', remaining: ['copied'] },
  ] as const)('fails when the $removed resolution loses URL identity', ({ removed, remaining }) => {
    expect(resolutionStates(withoutIdentity(removed))).toEqual(remaining);
  });
});
