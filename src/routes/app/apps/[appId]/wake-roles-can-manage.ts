/**
 * portal#2464: who gets the wake-roles controls. Only a viewer the server says manages the App, acting as
 * themselves. Unknown (a failed or missing read) is read-only: the server still refuses a change, and this
 * list is not worth the "unknown keeps the controls" tolerance the key controls have.
 */
export function wakeRolesCanManage(viewerManages: { kind: string; manages?: boolean } | null | undefined, impersonating: boolean): boolean {
  return viewerManages?.kind === 'known' && viewerManages.manages === true && !impersonating;
}
