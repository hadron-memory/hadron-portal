import { expect, it } from 'vitest';
import { GRAPH_NODES_QUERY, MEMORY_NODES_QUERY, NODE_COLUMNS_NO_SIGNING_QUERY, NODE_COLUMNS_QUERY, NODE_FIELDS } from './queries';

const FIELDS = ['embeddingPendingAt', 'embeddingFailedAt', 'embeddingError'];

it('#1346 both node-columns queries select the embedding state', () => {
  for (const doc of [NODE_COLUMNS_QUERY, NODE_COLUMNS_NO_SIGNING_QUERY]) {
    for (const f of FIELDS) expect(doc).toContain(f);
  }
});

it('#1346 keeps embedding state out of the layout payload and the slim memoryNodes rows', () => {
  for (const doc of [NODE_FIELDS, MEMORY_NODES_QUERY, GRAPH_NODES_QUERY]) {
    for (const f of FIELDS) expect(doc).not.toContain(f);
  }
});
