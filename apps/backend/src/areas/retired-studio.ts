/** Paths of the retired shipped package. Retained only to keep its archived
 * files out of active AI context in migrated bases. Other user materials remain. */
const RETIRED_FILES=new Set([
  "ADAPTACAO-NIVOO.md",
  "COMO-INTERAGIR-COM-O-RESPONSAVEL.md",
  "NIVOO-REGRAS.md",
  "README.md",
  "architecture-baseline.md",
  "architecture-blueprint.md",
  "capability-contract.md",
  "doctrine/disciplines/architecture.md",
  "doctrine/disciplines/domain.md",
  "doctrine/disciplines/security.md",
  "doctrine/disciplines/testing.md",
  "doctrine/disciplines/visual-interface-quality.md",
  "doctrine/engineering-doctrine.md",
  "framework.md",
  "prompt-alinhamento.md",
  "shared/consuming-system-adoption.md",
  "shared/system-change-base.md",
  "specialty-creation.md",
  "system-remodeling.md"
]);
export function activeBaseMaterial(path:string,retiredStudioWorkflow=false):boolean{
  return !retiredStudioWorkflow||!RETIRED_FILES.has(path);
}
