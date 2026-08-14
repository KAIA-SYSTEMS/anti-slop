import { defineRule } from "@oxlint/plugins";
import type { ESTree, SourceCode } from "@oxlint/plugins";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceText: string): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceText);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceText);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceText);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceText.replace(/\s*:\s*unknown\s*$/u, "");
}

const boundaryCommentOwnerKinds = new Set([
  "ExportDefaultDeclaration",
  "ExportNamedDeclaration",
  "MethodDefinition",
  "PropertyDefinition",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "VariableDeclaration",
]);

function isBoundaryComment(value: string): boolean {
  return /\bBOUNDARY\s*:\s*\S/u.test(value);
}

function hasBoundaryComment(
  sourceCode: SourceCode,
  owner: ParameterOwner,
  parameter: Parameter,
): boolean {
  if (
    sourceCode
      .getCommentsBefore(parameter)
      .some((comment) => isBoundaryComment(comment.value))
  ) {
    return true;
  }

  let current: ESTree.Node = owner;
  while (true) {
    if (
      sourceCode
        .getCommentsBefore(current)
        .some((comment) => isBoundaryComment(comment.value))
    ) {
      return true;
    }
    if (
      boundaryCommentOwnerKinds.has(current.type) ||
      current.parent.type === "Program"
    ) {
      return false;
    }
    current = current.parent;
  }
}

/** Disallow unknown inputs unless a nearby comment documents the raw boundary. */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters unless a nearby BOUNDARY comment identifies the raw external source and immediate decoder.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type, or add a specific `BOUNDARY:` comment naming the unavoidable raw source and decode it immediately.",
    },
  },
  createOnce(context) {
    const checkParameters = (node: ParameterOwner) => {
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation?.typeAnnotation.type !== "TSUnknownKeyword") continue;
        const name = parameterName(parameter, context.sourceCode.getText(parameter));
        if (hasBoundaryComment(context.sourceCode, node, parameter)) continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId: "unknownParameter",
          data: { parameter: name },
        });
      }
    };

    return {
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
