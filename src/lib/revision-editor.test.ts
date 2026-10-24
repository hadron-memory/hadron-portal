// #1171: a revision's History row names the agent/worker behind the edit
// (server NodeRevision.editedByAgent / editedByWorker, #1610) beside the user.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { NODE_REVISIONS_QUERY, NODE_REVISION_QUERY } from '$lib/server/queries';
import { revisionEditorView } from './revision-editor';
import RevisionEditedBy from './components/RevisionEditedBy.svelte';

const worker = { id: 'w1', name: 'Gil', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil' };
const agent = { id: 'a1', name: 'Portal Engineer', urn: 'hrn:agent:hadronmemory.com:portal-engineer' };

describe('#1171 revision editor view', () => {
  it('keeps the user and adds the worker and agent behind the edit', () => {
    const v = revisionEditorView({
      editedByUser: { handle: 'holger', urn: 'hrn:user:holger' },
      editedByInfo: null,
      editedByWorker: worker,
      editedByAgent: agent,
    });
    expect(v.user?.handle).toBe('holger');
    expect(v.worker).toEqual(worker);
    expect(v.agent).toEqual(agent);
  });

  it('renders null actors as absent, never an empty chip', () => {
    const v = revisionEditorView({ editedByUser: null, editedByInfo: 'github:x', editedByWorker: null, editedByAgent: undefined });
    expect(v.worker).toBeNull();
    expect(v.agent).toBeNull();
    expect(v.info).toBe('github:x');
  });

  it('the filter text includes every name and URN the cell shows', () => {
    const text = revisionEditorView({
      editedByUser: { handle: 'holger', urn: 'hrn:user:holger' },
      editedByWorker: worker,
      editedByAgent: agent,
    }).searchText;
    for (const s of ['holger', 'hrn:user:holger', 'Gil', worker.urn, 'Portal Engineer', agent.urn]) {
      expect(text).toContain(s);
    }
  });
});

describe('#1171 History cell', () => {
  it('shows the worker and agent names with their URNs', () => {
    const { body } = render(RevisionEditedBy, {
      props: { view: revisionEditorView({ editedByUser: null, editedByInfo: null, editedByWorker: worker, editedByAgent: agent }) },
    });
    expect(body).toContain('Gil');
    expect(body).toContain(worker.urn);
    expect(body).toContain('Portal Engineer');
    expect(body).toContain(agent.urn);
  });

  it('shows no actor row when neither is present', () => {
    const { body } = render(RevisionEditedBy, {
      props: { view: revisionEditorView({ editedByUser: { handle: 'holger', urn: null }, editedByInfo: null, editedByWorker: null, editedByAgent: null }) },
    });
    expect(body).toContain('@holger');
    expect(body).not.toContain('data-testid="revision-worker"');
    expect(body).not.toContain('data-testid="revision-agent"');
  });
});

describe('#1171 revision reads', () => {
  it.each([['list', NODE_REVISIONS_QUERY], ['single revision', NODE_REVISION_QUERY]])('the %s read selects the acting worker and agent', (_, q) => {
    expect(q).toMatch(/editedByWorker\s*\{[^}]*\bid\b[^}]*\bname\b[^}]*\burn\b/);
    expect(q).toMatch(/editedByAgent\s*\{[^}]*\bid\b[^}]*\bname\b[^}]*\burn\b/);
  });

  it('the single-revision page shows only the actors, with no placeholder for a missing user', () => {
    const { body } = render(RevisionEditedBy, {
      props: { actorsOnly: true, view: revisionEditorView({ editedByUser: null, editedByInfo: null, editedByWorker: worker, editedByAgent: agent }) },
    });
    expect(body).toContain(worker.urn);
    expect(body).not.toContain('—');
  });
});
