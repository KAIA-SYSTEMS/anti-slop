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

type MockingSource = "framework" | "method" | "require" | null;
const maxResolutionDepth = 100;
const maxResolutionSteps = 20_000;
type ResolutionBudget = { remaining: number; exhausted: boolean };
const globalObjects = new Set(["globalThis", "global", "window", "self"]);
const arrayMutators = new Set(["splice", "push", "pop", "shift", "unshift", "sort", "reverse", "fill", "copyWithin"]);
type PropertyPath = readonly string[];

const maxStaticKeyLength = 256;
const maxStaticKeySteps = 1_000;

function staticString(
  sourceCode: SourceCode,
  node: ESTree.Node,
  budget = { steps: maxStaticKeySteps },
  depth = 0,
): string | null {
  if (depth >= maxResolutionDepth || budget.steps-- <= 0) return null;
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value.length <= maxStaticKeyLength ? node.value : null;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    const cooked = node.quasis[0].value.cooked;
    return cooked !== null && cooked !== undefined && cooked.length <= maxStaticKeyLength ? cooked : null;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    const left = staticString(sourceCode, node.left, budget, depth + 1);
    const right = staticString(sourceCode, node.right, budget, depth + 1);
    if (left === null || right === null || left.length + right.length > maxStaticKeyLength) return null;
    return left + right;
  }
  if (node.type === "Identifier") {
    const variable = resolveVariable(node, sourceCode);
    const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
    if (definition?.type === "Variable" && definition.node.type === "VariableDeclarator" &&
      definition.node.init !== null && definition.parent?.type === "VariableDeclaration" &&
      definition.parent.kind === "const" &&
      !variable?.references.some((reference) => reference.isWrite() && !reference.init)) {
      return staticString(sourceCode, definition.node.init, budget, depth + 1);
    }
  }
  return null;
}

function propertyKey(sourceCode: SourceCode, node: ESTree.Node, computed: boolean): string | null {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "number") return String(node.value);
  return staticString(sourceCode, node);
}

function arrayIndex(key: string): number | null {
  return /^(0|[1-9]\d*)$/.test(key) ? Number(key) : null;
}

/** Project a destructured binding, including members retained by object/array rest. */
function bindingPath(sourceCode: SourceCode, pattern: ESTree.Node, name: string, path: PropertyPath, depth = 0): PropertyPath | null {
  if (depth >= maxResolutionDepth) return null;
  if (pattern.type === "Identifier") return pattern.name === name ? path : null;
  if (pattern.type === "AssignmentPattern") return bindingPath(sourceCode, pattern.left, name, path, depth + 1);
  if (pattern.type === "ObjectPattern") {
    for (const property of pattern.properties) {
      if (property.type === "RestElement") {
        const rest = bindingPath(sourceCode, property.argument, name, path, depth + 1);
        if (rest === null || rest.length === 0) continue;
        const excluded = pattern.properties
          .filter((member) => member.type === "Property")
          .map((member) => propertyKey(sourceCode, member.key, member.computed));
        return excluded.includes(null) || excluded.includes(rest[0]) ? null : rest;
      }
      const key = propertyKey(sourceCode, property.key, property.computed);
      const rest = bindingPath(sourceCode, property.value, name, path, depth + 1);
      if (key !== null && rest !== null) return [key, ...rest];
    }
  }
  if (pattern.type === "ArrayPattern") {
    for (const [index, element] of pattern.elements.entries()) {
      if (element === null) continue;
      if (element.type === "RestElement") {
        const rest = bindingPath(sourceCode, element.argument, name, path, depth + 1);
        const offset = rest === null || rest.length === 0 ? null : arrayIndex(rest[0]);
        if (rest !== null && offset !== null) return [String(index + offset), ...rest.slice(1)];
        continue;
      }
      const rest = bindingPath(sourceCode, element, name, path, depth + 1);
      if (rest !== null) return [String(index), ...rest];
    }
  }
  return null;
}

function unwrap(expression: ESTree.Expression): ESTree.Expression {
  while (expression.type === "TSAsExpression" || expression.type === "TSSatisfiesExpression" ||
    expression.type === "TSNonNullExpression" || expression.type === "TSTypeAssertion" ||
    expression.type === "ParenthesizedExpression" || expression.type === "ChainExpression") {
    expression = expression.expression;
  }
  return expression;
}

function mutatesArgument(sourceCode: SourceCode, call: ESTree.CallExpression, target: ESTree.Node): boolean {
  if (call.arguments[0] !== target) return false;
  const callee = unwrap(call.callee);
  if (callee.type !== "MemberExpression" || callee.object.type !== "Identifier") return false;
  const name = propertyKey(sourceCode, callee.property, callee.computed);
  return (callee.object.name === "Object" &&
    (name === "assign" || name === "defineProperty" || name === "defineProperties")) ||
    (callee.object.name === "Reflect" && name === "set");
}

const stableMembersCache = new WeakMap<Variable, boolean>();

/** Changed holders and their local aliases no longer prove member provenance. */
function hasStableMembers(sourceCode: SourceCode, variable: Variable): boolean {
  const cached = stableMembersCache.get(variable);
  if (cached !== undefined) return cached;
  const stable = scanStableMembers(sourceCode, variable);
  stableMembersCache.set(variable, stable);
  return stable;
}

function scanStableMembers(sourceCode: SourceCode, variable: Variable): boolean {
  const pending = [variable];
  const visited = new Set<Variable>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    for (const reference of current.references) {
      if (reference.init) continue;
      let node: ESTree.Node = reference.identifier;
      while (true) {
        const parent: ESTree.Node = node.parent;
        if ((parent.type === "MemberExpression" && parent.object === node) ||
          ((parent.type === "TSAsExpression" || parent.type === "TSSatisfiesExpression" ||
            parent.type === "TSNonNullExpression" || parent.type === "TSTypeAssertion" ||
            parent.type === "ParenthesizedExpression" || parent.type === "ChainExpression") &&
            parent.expression === node) ||
          (parent.type === "Property" && parent.value === node) ||
          parent.type === "ObjectExpression" || parent.type === "ArrayExpression" ||
          parent.type === "ObjectPattern" || parent.type === "ArrayPattern" ||
          parent.type === "LogicalExpression" ||
          (parent.type === "ConditionalExpression" && parent.test !== node) ||
          (parent.type === "SequenceExpression" && parent.expressions[parent.expressions.length - 1] === node) ||
          (parent.type === "AssignmentPattern" && parent.left === node) ||
          (parent.type === "RestElement" && parent.argument === node)) {
          node = parent;
          continue;
        }
        if ((parent.type === "AssignmentExpression" && parent.left === node) ||
          parent.type === "UpdateExpression" ||
          (parent.type === "UnaryExpression" && parent.operator === "delete") ||
          ((parent.type === "ForInStatement" || parent.type === "ForOfStatement") && parent.left === node)) return false;
        if (parent.type === "CallExpression" &&
          (mutatesArgument(sourceCode, parent, node) || (parent.callee === node && node.type === "MemberExpression" &&
            arrayMutators.has(propertyKey(sourceCode, node.property, node.computed) ?? "")))) return false;
        if (parent.type === "VariableDeclarator" && parent.init === node) {
          for (const alias of sourceCode.getDeclaredVariables(parent)) pending.push(alias);
        } else if (parent.type === "AssignmentExpression" && parent.right === node && parent.left.type === "Identifier") {
          const alias = resolveVariable(parent.left, sourceCode);
          if (alias !== null) pending.push(alias);
        }
        break;
      }
    }
  }
  return true;
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

/** Resolve literal spread sources without trusting mutated or cyclic holders. */
function spreadValue(sourceCode: SourceCode, expression: ESTree.Expression): ESTree.Expression | null {
  const visited = new Set<Variable>();
  while (true) {
    expression = unwrap(expression);
    if (expression.type !== "Identifier") return expression;
    const variable = resolveVariable(expression, sourceCode);
    if (variable === null || variable.defs.length !== 1 || visited.has(variable)) return null;
    visited.add(variable);
    const [definition] = variable.defs;
    if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator" ||
      definition.node.id.type !== "Identifier" || definition.node.init === null ||
      variable.references.some((reference) => reference.isWrite() && !reference.init) ||
      !hasStableMembers(sourceCode, variable)) return null;
    expression = definition.node.init;
  }
}

function arrayElements(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  depth: number,
  budget: ResolutionBudget,
): (ESTree.Expression | null)[] | null {
  if (depth >= maxResolutionDepth || budget.exhausted) {
    budget.exhausted = true;
    return null;
  }
  const value = spreadValue(sourceCode, expression);
  if (value?.type !== "ArrayExpression") return null;
  const elements: (ESTree.Expression | null)[] = [];
  for (const element of value.elements) {
    if (budget.remaining-- <= 0) {
      budget.exhausted = true;
      return null;
    }
    if (element?.type === "SpreadElement") {
      const spread = arrayElements(sourceCode, element.argument, depth + 1, budget);
      if (spread === null) return null;
      for (const element of spread) elements.push(element);
    } else {
      elements.push(element);
    }
  }
  return elements;
}

/** Follow stable aliases iteratively; bound recursive branching and spread expansion. */
function mockingSource(
  sourceCode: SourceCode,
  expression: ESTree.Expression,
  path: PropertyPath = [],
  visited = new Set<Variable>(),
  depth = 0,
  budget: ResolutionBudget = { remaining: maxResolutionSteps, exhausted: false },
): MockingSource {
  if (depth >= maxResolutionDepth || budget.exhausted) {
    budget.exhausted = true;
    return null;
  }
  const resolve = (value: ESTree.Expression, projection = path): MockingSource => {
    const source = mockingSource(sourceCode, value, projection, new Set(visited), depth + 1, budget);
    return budget.exhausted ? null : source;
  };
  while (true) {
    if (budget.remaining-- <= 0 || budget.exhausted) {
      budget.exhausted = true;
      return null;
    }
    expression = unwrap(expression);
    if (expression.type === "Identifier") {
      const variable = resolveVariable(expression, sourceCode);
      if (variable === null || variable.defs.length === 0) {
        if (expression.name === "require" && path.length === 0) return "require";
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
        (path.length > 0 && !hasStableMembers(sourceCode, variable))) return null;
      const projection = bindingPath(sourceCode, definition.node.id, expression.name, path);
      if (projection === null) return null;
      visited.add(variable);
      expression = definition.node.init;
      path = projection;
      continue;
    }
    if (expression.type === "MemberExpression") {
      const name = propertyKey(sourceCode, expression.property, expression.computed);
      if (name === null) return null;
      const base = unwrap(expression.object);
      if ((name === "vi" || name === "jest") && base.type === "Identifier" &&
        globalObjects.has(base.name) && (resolveVariable(base, sourceCode)?.defs.length ?? 0) === 0) {
        return frameworkSource(path);
      }
      expression = expression.object;
      path = [name, ...path];
      continue;
    }
    if (expression.type === "AwaitExpression") {
      expression = expression.argument;
      continue;
    }
    if (expression.type === "SequenceExpression") {
      expression = expression.expressions[expression.expressions.length - 1];
      continue;
    }
    if (expression.type === "ConditionalExpression" || expression.type === "LogicalExpression") {
      const left = resolve(expression.type === "ConditionalExpression" ? expression.consequent : expression.left);
      const right = resolve(expression.type === "ConditionalExpression" ? expression.alternate : expression.right);
      if (budget.exhausted) return null;
      return left === "method" || right === "method" ? "method" : left ?? right;
    }
    if (expression.type === "ImportExpression") {
      return expression.source.type === "Literal" && typeof expression.source.value === "string"
        ? moduleSource(expression.source.value, path) : null;
    }
    if (expression.type === "CallExpression") {
      const callee = unwrap(expression.callee);
      if (resolve(callee, []) === "require") {
        const source = expression.arguments[0];
        return source?.type === "Literal" && typeof source.value === "string"
          ? moduleSource(source.value, path) : null;
      }
      if (callee.type === "MemberExpression" && memberName(callee) === "bind" &&
        resolve(callee.object, []) === "method") return methodSource(path);
    }
    const [key, ...rest] = path;
    if (path.length === 0) return null;
    if (expression.type === "ObjectExpression") {
      const properties = [...expression.properties];
      let expansions = 0;
      while (properties.length > 0) {
        const property = properties.pop();
        if (property === undefined) break;
        if (property.type === "SpreadElement") {
          if (++expansions >= maxResolutionDepth) return null;
          if (resolve(property.argument, []) === "framework") return frameworkSource(path);
          const value = spreadValue(sourceCode, property.argument);
          if (value?.type !== "ObjectExpression") return null;
          for (const property of value.properties) properties.push(property);
          continue;
        }
        const name = propertyKey(sourceCode, property.key, property.computed);
        if (name === null) return null;
        if (name === key) return property.kind === "init" ? resolve(property.value, rest) : null;
      }
      return null;
    }
    if (expression.type === "ArrayExpression") {
      let index = arrayIndex(key);
      if (index === null) return null;
      let selected: ESTree.Expression | null = null;
      for (const element of expression.elements) {
        if (element?.type === "SpreadElement") {
          const spread = arrayElements(sourceCode, element.argument, depth + 1, budget);
          if (spread === null) return null;
          if (index < spread.length) {
            selected = spread[index];
            break;
          }
          index -= spread.length;
        } else if (index-- === 0) {
          selected = element;
          break;
        }
      }
      if (selected === null) return null;
      expression = selected;
      path = rest;
      continue;
    }
    return null;
  }
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
        const origin = callee.type === "Super" ? null : mockingSource(context.sourceCode, callee);
        if (origin === "require") {
          const source = node.arguments[0];
          if (source !== undefined && source.type !== "SpreadElement" && isMockingModule(source)) {
            context.report({ node, messageId: "mockImport" });
          }
        }
        if (origin === "method") {
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
        if (isMockingModule(node.source) && !(frameworkModules.has(node.source.value) &&
          (node.importKind === "type" || (node.specifiers.length > 0 && node.specifiers.every((specifier) =>
            specifier.type === "ImportSpecifier" && specifier.importKind === "type"))))) {
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
        if (isMockingModule(node.source) && !(frameworkModules.has(node.source.value) &&
          (node.exportKind === "type" || node.specifiers.every((specifier) => specifier.exportKind === "type")))) {
          context.report({ node, messageId: "mockImport" });
          return;
        }
        for (const specifier of node.specifiers) {
          const name = specifier.local.type === "Identifier" ? specifier.local.name : specifier.local.value;
          if ((node.exportKind !== "type" && specifier.exportKind !== "type" &&
            moduleSource(node.source.value, [name]) === "method") ||
            (frameworkModules.has(node.source.value) && mockImports.has(name))) {
            context.report({ node: specifier, messageId: "mockImport" });
          }
        }
      },
      ExportAllDeclaration(node) {
        if ((node.exportKind !== "type" && frameworkModules.has(node.source.value)) ||
          (isMockingModule(node.source) && !(node.exportKind === "type" && frameworkModules.has(node.source.value)))) {
          context.report({ node, messageId: "mockImport" });
        }
      },
    };
  },
});
