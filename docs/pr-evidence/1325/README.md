# Restored roleless selection (#1325)

Synthetic private `glen1325` stack, hadron-server
`53e12896e7d70942b87f56f01c5fd6efb07cc9d9`, API18425 / portal18525.
Real dev-login handoff as `alpha-admin@e2e.test`, Chromium,1280/390px, actual
theme toggle. The synthetic coordinator Agent's role was cleared through the
real API, then a stale selected option was injected into the browser fixture.
The normal picker still excludes that Agent. This deliberately exercises the
restored/stale selection state, not an ordinary selectable roleless option.

All four views show explicit no-role feedback and exactly one shared Agent
URN chip, with no role input and the form within the viewport. Choosing a valid
Agent and clearing selection both still work. Null/empty/whitespace restored
state variants are covered in the mounted suite. Preview/stack were torn down.
Independent browser QA remains a separate seat.
