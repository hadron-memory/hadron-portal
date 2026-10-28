/** Requester attestation token, never a claim of server eligibility. */
export const WORKER_DELETE_CONFIRMATION = 'verified-no-external-attribution';
export interface DeleteWorkerResult {
  ok: boolean;
  workerRef: string;
  message: string;
  code?: string | null;
}
