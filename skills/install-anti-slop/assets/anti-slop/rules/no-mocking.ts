import { defineRule } from "@oxlint/plugins";

import { isPackageImport } from "../shared/imported-module.ts";
import { resolveVariable } from "../shared/local-bindings.ts";
import { importedName, isTestFrameworkObject, memberName } from "../shared/test-framework.ts";

import type { ESTree, SourceCode, Variable } from "@oxlint/plugins";

const frameworkMethods = new Set([
  "fn", "spyOn", "mock", "doMock", "unmock", "doUnmock", "unstable_mockModule",
  "importMock", "importActual", "mocked", "hoisted", "stubGlobal", "stubEnv",
  "unstubAllGlobals", "unstubAllEnvs", "restoreAllMocks", "resetAllMocks", "clearAllMocks",
  "isMockFunction",
]);
const mockMethods = new Set([
  "mockImplementation", "mockImplementationOnce", "mockReturnValue", "mockReturnValueOnce",
  "mockResolvedValue", "mockResolvedValueOnce", "mockRejectedValue", "mockRejectedValueOnce",
  "mockReturnThis", "mockClear", "mockReset", "mockRestore", "mockName",
]);
const mockMatchers = new Set([
  "toHaveBeenCalled", "toHaveBeenCalledTimes", "toHaveBeenCalledWith", "toHaveBeenLastCalledWith",
  "toHaveBeenNthCalledWith", "toHaveBeenCalledOnce", "toHaveReturned", "toHaveReturnedTimes",
  "toHaveReturnedWith", "toHaveLastReturnedWith", "toHaveNthReturnedWith", "toBeCalled",
  "toBeCalledTimes", "toBeCalledWith", "lastCalledWith", "nthCalledWith", "toReturn",
  "toReturnTimes", "toReturnWith", "lastReturnedWith", "nthReturnedWith",
]);
const mockMetadata = new Set(["calls", "results", "lastCall", "instances", "invocationCallOrder"]);
const mockImports = new Set(["Mock", "MockInstance", "Mocked", "MockedFunction", "MockedObject", "MockedClass"]);
const frameworkModules = new Set(["vitest", "vite-plus/test", "@vitest/spy", "@jest/globals", "jest-mock"]);
const defaultModules = [
  "sinon", "msw", "nock", "fetch-mock", "vitest-mock-extended", "jest-mock-extended",
  "ts-mockito", "testdouble", "aws-sdk-client-mock", "@vitest/spy",
];

function unwrap(expression: ESTree.Expression): ESTree.Expression {
  while (expression.type === "TSAsExpression" || expression.type === "TSSatisfiesExpression" ||
    expression.type === "TSNonNullExpression" || expression.type === "TSTypeAssertion" ||
    expression.type === "ParenthesizedExpression") {
    expression = expression.expression;
  }
  return expression;
}

/** Follow constant aliases back to a framework object or one of its mocking APIs. */
function mockingSource(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  visited = new Set<Variable>(),
): "framework" | "method" | null {
  expression = unwrap(expression);
  if (expression.type === "Identifier") {
    const identifierName = expression.name;
    if (isTestFrameworkObject(sourceCode, expression)) return "framework";
    const variable = resolveVariable(expression, sourceCode);
    if (variable === null || variable.defs.length !== 1 || visited.has(variable)) return null;
    const [definition] = variable.defs;
    if (definition.type === "ImportBinding" && definition.parent?.type === "ImportDeclaration" &&
      isPackageImport(definition.parent.source, ["@vitest/spy"])) {
      if (definition.node.type === "ImportNamespaceSpecifier") return "framework";
      const name = importedName(definition.node);
      return name !== null && frameworkMethods.has(name) ? "method" : null;
    }
    if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator" ||
      definition.node.init === null || definition.parent?.type !== "VariableDeclaration" ||
      definition.parent.kind !== "const") return null;
    const nextVisited = new Set(visited).add(variable);
    const { id, init } = definition.node;
    if (id.type === "Identifier") return mockingSource(sourceCode, init, nextVisited);
    if (id.type !== "ObjectPattern" || mockingSource(sourceCode, init, nextVisited) !== "framework") return null;
    for (const property of id.properties) {
      if (property.type !== "Property") continue;
      const binding = property.value.type === "AssignmentPattern" ? property.value.left : property.value;
      if (binding.type !== "Identifier" || binding.name !== identifierName) continue;
      const name = property.key.type === "Literal" && typeof property.key.value === "string"
        ? property.key.value
        : !property.computed && property.key.type === "Identifier" ? property.key.name : null;
      return name !== null && frameworkMethods.has(name) ? "method" : null;
    }
    return null;
  }
  if (expression.type === "MemberExpression") {
    const name = memberName(expression);
    return name !== null && frameworkMethods.has(name) &&
      mockingSource(sourceCode, expression.object, visited) === "framework" ? "method" : null;
  }
  if (expression.type === "CallExpression") {
    const callee = unwrap(expression.callee);
    if (callee.type === "MemberExpression" && memberName(callee) === "bind" &&
      mockingSource(sourceCode, callee.object, visited) === "method") return "method";
  }
  return null;
}

/** Ban mocking APIs, mock assertions and mocking libraries. */
export const noMockingRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "Disallow mocking; test through the real interface instead of replacing parts of the system.",
    },
    schema: [{
      type: "object",
      properties: { modules: { type: "array", items: { type: "string" } } },
      additionalProperties: false,
    }],
    messages: {
      mocking: "Test through the real interface instead of replacing parts of the system with mocks, spies, or stubs.",
      mockAssertion: "Test behavior through the real interface instead of inspecting mocks that replace parts of the system.",
      mockImport: "Test through the real interface instead of importing mocking tools that replace parts of the system.",
    },
  },
  createOnce(context) {
    const isMockingModule = (source: ESTree.Expression): boolean => {
      const option = context.options[0];
      if (typeof option === "object" && option !== null && !Array.isArray(option) && Array.isArray(option.modules)) {
        const modules = option.modules.filter((module): module is string => typeof module === "string");
        return isPackageImport(source, modules);
      }
      return isPackageImport(source, defaultModules);
    };

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type === "Identifier" && callee.name === "require") {
          const source = node.arguments[0];
          if (source !== undefined && source.type !== "SpreadElement" && isMockingModule(source)) {
            context.report({ node, messageId: "mockImport" });
          }
        }
        if (callee.type !== "Super" && mockingSource(context.sourceCode, callee) === "method") {
          context.report({ node, messageId: "mocking" });
          return;
        }
        if (callee.type !== "MemberExpression") return;
        const name = memberName(callee);
        if (name === null) return;
        if (mockMethods.has(name)) {
          context.report({ node, messageId: "mocking" });
        } else if (mockMatchers.has(name)) {
          context.report({ node, messageId: "mockAssertion" });
        }
      },
      MemberExpression(node) {
        const name = memberName(node);
        const object = unwrap(node.object);
        if (name !== null && mockMetadata.has(name) && object.type === "MemberExpression" && memberName(object) === "mock") {
          context.report({ node, messageId: "mockAssertion" });
        }
      },
      ImportDeclaration(node) {
        if (isMockingModule(node.source)) {
          context.report({ node, messageId: "mockImport" });
        } else if (frameworkModules.has(node.source.value)) {
          for (const specifier of node.specifiers) {
            const name = importedName(specifier);
            if (name !== null && mockImports.has(name)) {
              context.report({ node: specifier, messageId: "mockImport" });
            }
          }
        }
      },
      ImportExpression(node) {
        if (isMockingModule(node.source)) context.report({ node, messageId: "mockImport" });
      },
    };
  },
});
