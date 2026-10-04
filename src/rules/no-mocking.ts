import { defineRule } from "@oxlint/plugins";

import { isPackageImport } from "../shared/imported-module.ts";
import { importedName, isTestFrameworkObject, memberName } from "../shared/test-framework.ts";

import type { ESTree } from "@oxlint/plugins";

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
const frameworkModules = new Set(["vitest", "@jest/globals", "jest-mock"]);
const defaultModules = [
  "sinon", "msw", "nock", "fetch-mock", "vitest-mock-extended", "jest-mock-extended",
  "ts-mockito", "testdouble", "aws-sdk-client-mock",
];

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
        if (callee.type !== "MemberExpression") return;
        const name = memberName(callee);
        if (name === null) return;
        if (mockMethods.has(name) || (frameworkMethods.has(name) && isTestFrameworkObject(context.sourceCode, callee.object))) {
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
    };
  },
});
