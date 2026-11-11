/** Unit-test host for the Section-owned Manager callbacks, without readback. */
export function managerCallbacks() {
  return {
    onMutationPending: () => {},
    onAction: () => 0,
    onCommitted: () => {},
    onUncertain: () => {},
  };
}
