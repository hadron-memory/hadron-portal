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
/** A short name with the usual chip: here the chip, not the name row, is what makes the label wide. */
export const SHORT_WORKER_NAME = 'Iris';

// Row ids. The harness finds a row's name link by its href, never by the title it is testing.
export const LONG_ROW_ID = 'w-long';
export const SHORT_ROW_ID = 'w-short';
/** The long name with no URN (`urn` is nullable by contract): the one row without a chip. */
export const NO_CHIP_ROW_ID = 'w-nochip';

const worker = (id: string, name: string, urn: string | null): AgentTaskParty => ({ id, kind: 'WORKER', name, urn });
const personParty: AgentTaskParty = { id: `u-${LONG_PERSON_NAME}`, kind: 'USER', name: LONG_PERSON_NAME, urn: null };

/**
 * Four rows in one table. The long worker's row carries the name link, the
 * AI-worker badge and the compact Urn chip; the person row carries the plain
 * name branch; the short worker's row shows a name that has room to spare; the
 * no-chip row is the name row on its own, for the pins the chip would widen.
 */
export function mountPartyLabelCell(target: HTMLElement) {
  const instance = mount(PartyLabelDefeatTable, {
    target,
    props: {
      rows: [
        { id: 'r-worker', party: worker(LONG_ROW_ID, LONG_WORKER_NAME, LONG_WORKER_URN), note: 'the worker row: name, badge, chip' },
        { id: 'r-person', party: personParty, note: 'the person row: name only' },
        { id: 'r-short', party: worker(SHORT_ROW_ID, SHORT_WORKER_NAME, `hrn:worker:example.test:fixture:${SHORT_WORKER_NAME.toLowerCase()}`), note: 'the short worker row: the chip is the wide item' },
        { id: 'r-nochip', party: worker(NO_CHIP_ROW_ID, LONG_WORKER_NAME, null), note: 'the no-chip row: the name row on its own' },
      ],
    },
  });
  return () => unmount(instance);
}
