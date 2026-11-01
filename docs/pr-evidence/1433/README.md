# Node page bounded reads (#1433, D3): author evidence

Refs #1433. These are author checks; they do not replace the review or QA seats.

**Setup**
- Stack: a private disposable e2e stack (`scripts/e2e/stack.sh`) at hadron-server `bf76c1719`, with this branch's portal pointed at it.
- Sign-in: dev login as the synthetic `alpha-admin@e2e.test`.
- Theme: set through localStorage `theme`.
- Viewport: 1280px. The layout is unchanged, so no 390px pass.

**Fixture**
Synthetic nodes in `e2e-alpha:knowledge`:
- `specs` / `specs:auth` / `specs:auth:oauth` / `specs:auth:jwt`, where `jwt`'s body links `[[specs:auth]]`, `[[specs:auth:oauth|the OAuth spec]]`, `[[welcome]]` and the dangling `[[specs:never-written]]`;
- a chat root `chats:design` with the message `chats:design:messages:001`.

**Observed, identical in light and dark** ([results.json](results.json)):
- **Breadcrumb:** "Specifications" and "Authentication" are links to their nodes; on the jwt page nothing offers "Create parent node". On the message, "Design chat" is a link, and "Create parent node" is offered only for `chats` and `messages`, which have no node.
- **Wikilinks:** three resolve to node links with the node name as label. `[[specs:never-written]]` is the only unresolved marker.
- **Open chat:** the chat message offers "Open chat" in the node actions menu.
- **Edge target:** typing "auth" suggests `specs:auth` and `specs:auth:oauth` from this memory. The native datalist popup is not captured by a screenshot; the options are in results.json.

Ground rules 1-6 (build-portal-ui): pass. No new headings or buttons: the change adds suggestions to two existing inputs and turns the degraded crumbs and links back into links.

| State | Light | Dark |
| --- | --- | --- |
| Nested node: crumbs and wikilinks | [png](node-jwt-1280-light.png) | [png](node-jwt-1280-dark.png) |
| Chat message: Open chat | [png](message-open-chat-1280-light.png) | [png](message-open-chat-1280-dark.png) |
| Edges editor: target typeahead | [png](edge-typeahead-1280-light.png) | [png](edge-typeahead-1280-dark.png) |

Not covered here: the node-to-node foreground trace against 5 KB / 269 ms is the browser QA seat's, at the frozen head.
