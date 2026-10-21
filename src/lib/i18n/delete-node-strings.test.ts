import { describe, expect, it } from 'vitest';
import { deleteNodeStrings } from './delete-node-strings';

describe('deleteNodeStrings.confirmPrompt (#1160)', () => {
  it('names the node and says the delete is findable, not irreversible', () => {
    const text = deleteNodeStrings.confirmPrompt('Office Facts');
    expect(text).toContain('"Office Facts"');
    expect(text).toContain('Include deleted');
    expect(text).not.toMatch(/cannot be undone/i);
  });
});

describe('node page Danger zone (#1160)', () => {
  it('uses the soft-delete copy and no longer claims the delete is irreversible', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte', 'utf8');
    expect(page).toContain('deleteNodeStrings.confirmPrompt(node.name)');
    expect(page).not.toContain('Delete "{node.name}"? This cannot be undone.');
  });
});
