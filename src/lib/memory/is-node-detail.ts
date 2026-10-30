// Node detail / create pages bring their own chrome, so the memory's tab strip
// hides there. Matches /nodes/<id> and /nodes/new, never the bare /nodes tab.
export const isNodeDetailPath = (path: string): boolean => /\/nodes\/[^/]+/.test(path);
