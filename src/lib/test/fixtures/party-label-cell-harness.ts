// portal#2506: the PartyLabel containment pin, for the Chromium containment
// harness (scripts/test-table-cell-overflow-layout.mjs, kind "party-label").
// No API, no production data. Every value is within its contract: a worker
// name is free text chosen per App (a ~27-character name is the length the
// issue reports escaping), a person's name likewise, and a worker URN is the
// fully-qualified shape the server returns.
import { mount, unmount } from 'svelte';
import type { AgentTaskParty } from '$lib/agent-tasks/types';
import PartyLabelDefeatTable from './PartyLabelDefeatTable.svelte';

/** 27 characters — the worker-name length the #2506 report escapes with. */
export const LONG_WORKER_NAME = 'ConstantinThePortalEngineer';
export const LONG_WORKER_URN = `hrn:worker:example.test:fixture:${LONG_WORKER_NAME.toLowerCase()}`;
/** A person of the same shape: one unbroken token, no URN in this shape. */
export const LONG_PERSON_NAME = 'AVeryLongUnbrokenPersonName';

const workerParty: AgentTaskParty = { id: `w-${LONG_WORKER_NAME}`, kind: 'WORKER', name: LONG_WORKER_NAME, urn: LONG_WORKER_URN };
const personParty: AgentTaskParty = { id: `u-${LONG_PERSON_NAME}`, kind: 'USER', name: LONG_PERSON_NAME, urn: null };

/** Both parties in one table: the worker row carries the name link, the AI-worker badge and the compact Urn chip; the person row carries the plain name branch. */
export function mountPartyLabelCell(target: HTMLElement) {
  const instance = mount(PartyLabelDefeatTable, {
    target,
    props: {
      rows: [
        { id: 'r-worker', party: workerParty, note: 'the worker row: name, badge, chip' },
        { id: 'r-person', party: personParty, note: 'the person row: name only' },
      ],
    },
  });
  return () => unmount(instance);
}
