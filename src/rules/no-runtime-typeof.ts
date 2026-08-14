import { defineRule } from "@oxlint/plugins";

import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";

function unwrapParentheses(expression: ESTree.Expression): ESTree.Expression {
  let current = expression;
  while (current.type === "ParenthesizedExpression") current = current.expression;
  return current;
}

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

function explicitlyUnknown(identifier: ESTree.BindingIdentifier): boolean {
  return identifier.typeAnnotation?.typeAnnotation.type === "TSUnknownKeyword";
}

function narrowsExplicitUnknown(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
): boolean {
  const unwrapped = unwrapParentheses(expression);
  if (unwrapped.type !== "Identifier") return false;
  const variable = resolveVariable(sourceCode, unwrapped);
  return variable !== null && variable.identifiers.some(explicitlyUnknown);
}

/** Require schema decoding instead of ad hoc typeof narrowing for explicitly unknown values. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow typeof checks on explicitly unknown bindings; decode raw input with its owner schema while permitting typed-union branching and runtime feature detection.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` check narrows raw `unknown` without establishing its contract. Decode it with the expected schema at the I/O boundary.",
    },
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        if (
          node.operator === "typeof" &&
          narrowsExplicitUnknown(context.sourceCode, node.argument)
        ) {
          context.report({ node, messageId: "runtimeTypeof" });
        }
      },
    };
  },
});
