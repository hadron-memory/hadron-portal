import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const layout = () => readFileSync('src/routes/app/+layout.svelte', 'utf8');
const oracle = () => readFileSync('scripts/test-agent-chat-phone-layout.mjs', 'utf8');

describe('app shell shared with the AgentChat layout oracle', () => {
  it('preserves the three production class strings', async () => {
    const shell = await import('./app-shell');
    expect(shell.APP_SHELL_ROW).toBe('flex gap-4 px-4 py-8 sm:gap-8 sm:px-6');
    expect(shell.appShellNavClass(null)).toBe('sticky top-8 self-start w-48 shrink-0 flex-col hidden sm:flex');
    expect(shell.appShellNavClass(true)).toBe('sticky top-8 self-start w-48 shrink-0 flex-col flex');
    expect(shell.APP_SHELL_CONTENT).toBe('min-w-0 flex-1');
  });

  it('binds the production shell elements to app-shell.ts', () => {
    const source = layout();
    expect(source, 'layout must import app-shell.ts').toMatch(/from ['"]\$lib\/layout\/app-shell['"]/);
    expect(source, 'layout row must use app-shell.ts').toMatch(/<div\s+class=\{APP_SHELL_ROW\}>/);
    expect(source, 'layout nav must use app-shell.ts').toMatch(/<aside\s+class=\{appShellNavClass\(menuOpen\)\}/);
    expect(source, 'layout content must use app-shell.ts').toMatch(/<div\s+class=\{APP_SHELL_CONTENT\}>/);
  });

  it('binds the oracle shell elements to app-shell.ts', () => {
    const text = oracle();
    const source = text.slice(text.lastIndexOf('async ({ css, dark }) => {'), text.lastIndexOf('{ css, dark },'));
    expect(source, 'oracle must import app-shell.ts through Vite').toContain("import('/src/lib/layout/app-shell.ts')");
    expect(source, 'oracle row must use app-shell.ts').toContain('${shell.APP_SHELL_ROW}');
    expect(source, 'oracle nav must use app-shell.ts').toContain('${shell.appShellNavClass(null)}');
    expect(source, 'oracle content must use app-shell.ts').toContain('${shell.APP_SHELL_CONTENT}');
  });
});
