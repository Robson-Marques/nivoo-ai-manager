/** Shared selection of the model configured by the project. */
export function projectModel(project: { aiModels: unknown }, providerId: string): string | undefined {
  const m = ((project.aiModels ?? {}) as Record<string, string>)[providerId];
  return m || undefined;
}
