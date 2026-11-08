import type { AiConfigCommitted, AiConfigMutationPending } from './ai-config-manager';

type Pending = Omit<AiConfigMutationPending, 'pending'>;
type Deferred = { outcome: AiConfigCommitted; order: number };
type Listener = () => void;

/**
 * Client-document recovery for AI writes. Component teardown must not erase a
 * pending mutation or an outcome that still needs readback. Entries contain
 * owner keys and display text only — never credentials or mutation payloads.
 * The user scope prevents a client-side account change inheriting the state.
 */
class AiConfigRecoveryStore {
  private pendingByOwner = new Map<string, Map<number, Pending>>();
  private deferredByOwner = new Map<string, Deferred>();
  private outcomeOrders = new WeakMap<AiConfigCommitted, number>();
  private listeners = new Set<Listener>();
  private nextOrder = 0;

  private emit() {
    for (const listener of [...this.listeners]) listener();
  }

  private orderFor(outcome: AiConfigCommitted): number {
    let order = this.outcomeOrders.get(outcome);
    if (order === undefined) {
      order = ++this.nextOrder;
      this.outcomeOrders.set(outcome, order);
    }
    return order;
  }

  setPending(outcome: AiConfigMutationPending) {
    let owner = this.pendingByOwner.get(outcome.ownerKey);
    if (outcome.pending) {
      if (!owner) {
        owner = new Map();
        this.pendingByOwner.set(outcome.ownerKey, owner);
      }
      owner.set(outcome.mutationId, { ownerKey: outcome.ownerKey, mutationId: outcome.mutationId });
    } else if (owner) {
      owner.delete(outcome.mutationId);
      if (owner.size === 0) this.pendingByOwner.delete(outcome.ownerKey);
    }
    this.emit();
  }

  pending(): Pending[] {
    return [...this.pendingByOwner.values()].flatMap((owner) => [...owner.values()]);
  }

  defer(outcome: AiConfigCommitted) {
    const order = this.orderFor(outcome);
    const existing = this.deferredByOwner.get(outcome.ownerKey);
    // An older confirmed read must never replace a newer uncertain outcome.
    if (existing && existing.order > order) return;
    this.deferredByOwner.set(outcome.ownerKey, { outcome, order });
    this.emit();
  }

  discardDeferred(outcome: AiConfigCommitted) {
    const order = this.orderFor(outcome);
    const existing = this.deferredByOwner.get(outcome.ownerKey);
    if (!existing || existing.order > order) return;
    this.deferredByOwner.delete(outcome.ownerKey);
    this.emit();
  }

  takeDeferred(ownerKey: string): AiConfigCommitted | undefined {
    const deferred = this.deferredByOwner.get(ownerKey);
    if (!deferred) return undefined;
    this.deferredByOwner.delete(ownerKey);
    this.emit();
    return deferred.outcome;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const stores = new Map<string, AiConfigRecoveryStore>();
let recoverySequence = 0;

export function getAiConfigRecoveryStore(userScope: string): AiConfigRecoveryStore {
  let store = stores.get(userScope);
  if (!store) {
    store = new AiConfigRecoveryStore();
    stores.set(userScope, store);
  }
  return store;
}

/** Negative IDs cannot collide with a Manager's positive per-instance IDs. */
export function nextAiConfigRecoveryId(): number {
  return --recoverySequence;
}

export function resetAiConfigRecoveryForTests() {
  stores.clear();
  recoverySequence = 0;
}
