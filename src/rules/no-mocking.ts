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

type MockingSource = "framework" | "method" | null;
type PropertyPath = readonly string[];

function propertyKey(node: ESTree.Node, computed: boolean): string | null {
  if (!computed && node.type === "Identifier") return node.name;
  return node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number")
    ? String(node.value) : null;
}

function arrayIndex(key: string): number | null {
  return /^(0|[1-9]\d*)$/.test(key) ? Number(key) : null;
}

/** Project a destructured binding, including members retained by object/array rest. */
function bindingPath(pattern: ESTree.Node, name: string, path: PropertyPath): PropertyPath | null {
  if (pattern.type === "Identifier") return pattern.name === name ? path : null;
  if (pattern.type === "AssignmentPattern") return bindingPath(pattern.left, name, path);
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        const rest = bindingPath(property.argument, name, path);
        if (rest === null || rest.length === 0) continue;
        const excluded = pattern.properties
          .filter((member) => member.type === "Property")
          .map((member) => propertyKey(member.key, member.computed));
        return excluded.includes(null) || excluded.includes(rest[0]) ? null : rest;
      }
      const key = propertyKey(property.key, property.computed);
      const rest = bindingPath(property.value, name, path);
      if (key !== null && rest !== null) return [key, ...rest];
    }
  }
  if (pattern.type === "ArrayPattern") {
    for (const [index, element] of pattern.elements.entries()) {
      if (element === null) continue;
      if (element.type === "RestElement") {
        const rest = bindingPath(element.argument, name, path);
        const offset = rest === null || rest.length === 0 ? null : arrayIndex(rest[0]);
        if (rest !== null && offset !== null) return [String(index + offset), ...rest.slice(1)];
        continue;
      }
      const rest = bindingPath(element, name, path);
      if (rest !== null) return [String(index), ...rest];
    }
  }
  return null;
}

function unwrap(expression: ESTree.Expression): ESTree.Expression {
  switch (expression.type) {
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "ParenthesizedExpression":
    case "ChainExpression":
      return unwrap(expression.expression);
    default:
      return expression;
  }
}

/** A directly changed holder no longer proves the provenance of its members. */
function hasStableMembers(variable: Variable): boolean {
  return variable.references.every((reference) => {
    let node: ESTree.Node = reference.identifier;
    while (true) {
      const parent: ESTree.Node = node.parent;
      if ((parent.type === "MemberExpression" && parent.object === node) ||
        ((parent.type === "TSAsExpression" || parent.type === "TSSatisfiesExpression" ||
          parent.type === "TSNonNullExpression" || parent.type === "TSTypeAssertion" ||
          parent.type === "ParenthesizedExpression" || parent.type === "ChainExpression") &&
          parent.expression === node)) {
        node = parent;
      } else {
        return !((parent.type === "AssignmentExpression" && parent.left === node) ||
          parent.type === "UpdateExpression" ||
          (parent.type === "UnaryExpression" && parent.operator === "delete"));
      }
    }
  });
}

function methodSource(path: PropertyPath): MockingSource {
  return path.length === 0 || (path.length === 1 && (path[0] === "call" || path[0] === "apply"))
    ? "method" : null;
}

function frameworkSource(path: PropertyPath): MockingSource {
  if (path.length === 0) return "framework";
  return frameworkMethods.has(path[0]) ? methodSource(path.slice(1)) : null;
}

function moduleSource(module: string, path: PropertyPath): MockingSource {
  const [name, ...rest] = path;
  if (((module === "vitest" || module === "vite-plus/test" || module === "@vitest/spy") && name === "vi") ||
    (module === "@jest/globals" && name === "jest")) return frameworkSource(rest);
  if ((module === "@vitest/spy" || module === "jest-mock") && frameworkMethods.has(name)) {
    return methodSource(rest);
  }
  return null;
}

/** Follow stable local aliases and static projections back to a framework mocking API. */
function mockingSource(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  path: PropertyPath = [],
  visited = new Set<Variable>(),
): MockingSource {
  expression = unwrap(expression);
  if (expression.type === "Identifier") {
    const variable = resolveVariable(expression, sourceCode);
    if (variable === null || variable.defs.length === 0) {
      return isTestFrameworkObject(sourceCode, expression) ? frameworkSource(path) : null;
    }
    if (variable.defs.length !== 1 || visited.has(variable)) return null;
    const [definition] = variable.defs;
    if (definition.type === "ImportBinding" && definition.parent?.type === "ImportDeclaration") {
      const declaration = definition.parent;
      const specifier = definition.node;
      if (declaration.importKind === "type" ||
        (specifier.type === "ImportSpecifier" && specifier.importKind === "type")) return null;
      if (specifier.type === "ImportNamespaceSpecifier" ||
        (specifier.type === "ImportDefaultSpecifier" && declaration.source.value === "jest-mock")) {
        return moduleSource(declaration.source.value, path);
      }
      const name = importedName(specifier);
      return name === null ? null : moduleSource(declaration.source.value, [name, ...path]);
    }
    if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator" ||
      definition.node.init === null || definition.parent?.type !== "VariableDeclaration" ||
      (definition.parent.kind !== "const" && definition.parent.kind !== "let") ||
      variable.references.some((reference) => reference.isWrite() && !reference.init) ||
      (path.length > 0 && !hasStableMembers(variable))) return null;
    const projection = bindingPath(definition.node.id, expression.name, path);
    return projection === null ? null : mockingSource(
      sourceCode, definition.node.init, projection, new Set(visited).add(variable),
    );
  }
  if (expression.type === "MemberExpression") {
    const name = propertyKey(expression.property, expression.computed);
    return name === null ? null : mockingSource(sourceCode, expression.object, [name, ...path], visited);
  }
  if (expression.type === "AwaitExpression") return mockingSource(sourceCode, expression.argument, path, visited);
  if (expression.type === "ImportExpression") {
    return expression.source.type === "Literal" && typeof expression.source.value === "string"
      ? moduleSource(expression.source.value, path) : null;
  }
  if (expression.type === "CallExpression") {
    const callee = unwrap(expression.callee);
    if (callee.type === "Identifier" && callee.name === "require" &&
      (resolveVariable(callee, sourceCode)?.defs.length ?? 0) === 0) {
      const source = expression.arguments[0];
      return source?.type === "Literal" && typeof source.value === "string"
        ? moduleSource(source.value, path) : null;
    }
    if (callee.type === "MemberExpression" && memberName(callee) === "bind" &&
      mockingSource(sourceCode, callee.object, [], visited) === "method") return methodSource(path);
  }
  const [key, ...rest] = path;
  if (path.length === 0) return null;
  if (expression.type === "ObjectExpression") {
    for (const property of [...expression.properties].reverse()) {
      if (property.type === "SpreadElement") return null;
      const name = propertyKey(property.key, property.computed);
      if (name === null) return null;
      if (name === key) return property.kind === "init"
        ? mockingSource(sourceCode, property.value, rest, visited) : null;
    }
  }
  if (expression.type === "ArrayExpression") {
    const index = arrayIndex(key);
    if (index === null || expression.elements.slice(0, index + 1).some((element) => element?.type === "SpreadElement")) return null;
    const element = expression.elements[index];
    return element == null || element.type === "SpreadElement"
      ? null : mockingSource(sourceCode, element, rest, visited);
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
        const callee = node.callee;
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
        if (name !== null && mockMetadata.has(name) && node.object.type === "MemberExpression" && memberName(node.object) === "mock") {
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
      ExportNamedDeclaration(node) {
        if (node.source === null) return;
        if (isMockingModule(node.source)) {
          context.report({ node, messageId: "mockImport" });
          return;
        }
        for (const specifier of node.specifiers) {
          const name = specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
          if (moduleSource(node.source.value, [name]) === "method" ||
            (frameworkModules.has(node.source.value) && mockImports.has(name))) {
            context.report({ node: specifier, messageId: "mockImport" });
          }
        }
      },
      ExportAllDeclaration(node) {
        if (isMockingModule(node.source)) context.report({ node, messageId: "mockImport" });
      },
    };
  },
});
