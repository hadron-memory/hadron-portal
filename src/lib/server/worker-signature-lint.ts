export const WORKER_SIGNATURE_LINT = /* GraphQL */ `query WorkerSignatureLinkLint($ref: ID!) { worker(ref: $ref) { signatureLint(first: 2) { items { kind workerField } total nextCursor } } }`;
