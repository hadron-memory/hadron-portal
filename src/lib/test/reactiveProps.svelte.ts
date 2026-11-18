/**
 * A props object whose fields are reactive, so a client test can change a prop AFTER mount the
 * way a parent page does when it reuses a component for a different subject (worker A -> B).
 * Pass the result as `props` to `mountComponent`; assign to its fields to re-render.
 */
export function reactiveProps<T extends Record<string, unknown>>(initial: T): T {
  const state = $state(initial);
  return state;
}
