// portal#2129 rows 1, 6, 8: validate every harness env knob before the dev server or a browser starts.
const KINDS = ['alarms', 'runs', 'config', 'findings', 'agent-tasks'];
const flag = (env, name) => {
  if (!(name in env) || env[name] === undefined) return false;
  if (env[name] !== '0' && env[name] !== '1') throw new Error(`${name} must be 0 or 1 when set, got ${JSON.stringify(env[name])}`);
  return env[name] === '1';
};
export function parseHarnessEnv(env) {
  let cellWidth = null;
  if (env.CELL_WIDTH !== undefined) {
    if (!/^[1-9][0-9]{0,4}$/.test(env.CELL_WIDTH)) throw new Error(`CELL_WIDTH must be a whole number of pixels from 1 to 99999, got ${JSON.stringify(env.CELL_WIDTH)}`);
    cellWidth = Number(env.CELL_WIDTH);
  }
  let cellKind = null;
  if (env.CELL_KIND !== undefined) {
    if (!KINDS.includes(env.CELL_KIND)) throw new Error(`CELL_KIND must be alarms, runs, config, findings or agent-tasks, got ${JSON.stringify(env.CELL_KIND)}`);
    cellKind = env.CELL_KIND;
  }
  const injectPointerFailure = flag(env, 'CELL_INJECT_POINTER_FAILURE');
  const injectMissingTrigger = flag(env, 'CELL_INJECT_MISSING_TRIGGER');
  // Both injections act only in the findings leg. Selecting another kind would announce a failure that cannot happen.
  for (const [name, on] of [['CELL_INJECT_POINTER_FAILURE', injectPointerFailure], ['CELL_INJECT_MISSING_TRIGGER', injectMissingTrigger]]) {
    if (on && cellKind !== null && cellKind !== 'findings') throw new Error(`${name}=1 only acts on the findings leg, got CELL_KIND=${JSON.stringify(cellKind)}`);
  }
  return { cellWidth, cellKind, injectPointerFailure, injectMissingTrigger };
}
// One line per knob that is exactly 1; silent for unset and 0.
export function injectionEcho(parsed) {
  return [
    parsed.injectPointerFailure && 'CELL_INJECT_POINTER_FAILURE',
    parsed.injectMissingTrigger && 'CELL_INJECT_MISSING_TRIGGER',
  ].filter(Boolean).map(name => `INJECTION ACTIVE: ${name}=1 (this run is expected to fail)`);
}
