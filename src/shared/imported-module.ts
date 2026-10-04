import type { ESTree } from "@oxlint/plugins";

/** Match a literal module specifier against packages and their subpaths. */
export function isPackageImport(source: ESTree.Expression, modules: readonly string[]): boolean {
  if (source.type !== "Literal" || typeof source.value !== "string") return false;
  const name = source.value;
  return modules.some((module) => name === module || name.startsWith(`${module}/`));
}
