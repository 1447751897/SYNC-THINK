/** Library configuration changes, not task/message progress, refresh picker catalogs. */
export function isAgentTeamLibraryEvent(type: string): boolean {
  return /^(?:globalAgent\.(?:created|updated|deleted|activationChanged)|team\.(?:created|updated|deleted))$/.test(type);
}
