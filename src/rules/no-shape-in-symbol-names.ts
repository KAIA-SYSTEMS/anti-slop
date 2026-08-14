import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const FORBIDDEN_SYMBOL_NAME = "shape";

function containsForbiddenSymbolName(name: string): boolean {
  return name.toLowerCase().includes(FORBIDDEN_SYMBOL_NAME);
}

/** Ban "shape" in locally controlled declarations without rejecting external member access. */
export const noForbiddenTermInSymbolNamesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        'Disallow the case-insensitive substring "shape" in locally controlled JavaScript and TypeScript declarations.',
    },
    messages: {
      forbiddenSymbolName:
        'Rename symbol "{{name}}" for its domain role; "shape" describes structure rather than ownership.',
    },
  },
  createOnce(context) {
    const report = (node: ESTree.Node | null) => {
      if (
        node === null ||
        (node.type !== "Identifier" && node.type !== "PrivateIdentifier") ||
        !containsForbiddenSymbolName(node.name)
      ) {
        return;
      }
      context.report({
        node,
        messageId: "forbiddenSymbolName",
        data: { name: node.name },
      });
    };

    const reportPattern = (pattern: ESTree.Node) => {
      switch (pattern.type) {
        case "Identifier":
          report(pattern);
          break;
        case "TSParameterProperty":
          reportPattern(pattern.parameter);
          break;
        case "AssignmentPattern":
          reportPattern(pattern.left);
          break;
        case "RestElement":
          reportPattern(pattern.argument);
          break;
        case "ArrayPattern":
          for (const element of pattern.elements) {
            if (element !== null) reportPattern(element);
          }
          break;
        case "ObjectPattern":
          for (const property of pattern.properties) {
            if (property.type === "RestElement") reportPattern(property.argument);
            else reportPattern(property.value);
          }
          break;
      }
    };

    const reportFunction = (
      node: ESTree.ArrowFunctionExpression | ESTree.Function,
    ) => {
      if ("id" in node) report(node.id);
      for (const parameter of node.params) reportPattern(parameter);
    };

    return {
      ArrowFunctionExpression: reportFunction,
      FunctionDeclaration: reportFunction,
      FunctionExpression: reportFunction,
      ClassDeclaration(node) {
        report(node.id);
      },
      ClassExpression(node) {
        report(node.id);
      },
      VariableDeclarator(node) {
        reportPattern(node.id);
      },
      CatchClause(node) {
        if (node.param !== null) reportPattern(node.param);
      },
      ImportDefaultSpecifier(node) {
        report(node.local);
      },
      ImportNamespaceSpecifier(node) {
        report(node.local);
      },
      ImportSpecifier(node) {
        report(node.local);
      },
      TSInterfaceDeclaration(node) {
        report(node.id);
      },
      TSTypeAliasDeclaration(node) {
        report(node.id);
      },
      TSEnumDeclaration(node) {
        report(node.id);
      },
      TSTypeParameter(node) {
        report(node.name);
      },
      MethodDefinition(node) {
        report(node.key);
      },
      PropertyDefinition(node) {
        report(node.key);
      },
      TSMethodSignature(node) {
        report(node.key);
      },
      TSPropertySignature(node) {
        report(node.key);
      },
    };
  },
});
