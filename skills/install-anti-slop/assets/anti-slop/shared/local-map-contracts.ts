import {
	aliasSubstitution,
	classifyUnsafeDictionaryValue,
	classifyUnsafeMap,
	type TypeAliasEnvironment,
	type TypeEnvironment,
	type UnsafeDictionary,
} from "./dictionary-types.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

import { resolveSource, resolveVariable } from "./local-bindings.ts";

export function isMapConstructor(
	node: ESTree.Node,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
): boolean {
	const source = resolveSource(node, environment, sourceCode);
	if (source?.node.type !== "Identifier" || resolveVariable(source.node, sourceCode)?.defs.length)
		return false;
	return (
		(source.node.name === "Map" && source.path.length === 0) ||
		(source.node.name === "globalThis" && source.path.length === 1 && source.path[0] === "Map")
	);
}

function classifyExpression(
	node: ESTree.Expression,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	substitutions: TypeAliasEnvironment,
): UnsafeDictionary | null {
	if (node.type === "NewExpression" && isMapConstructor(node.callee, environment, sourceCode)) {
		const value = node.typeArguments?.params[1];
		return value === undefined
			? null
			: classifyUnsafeDictionaryValue(value, environment, substitutions);
	}
	if (node.type === "ArrowFunctionExpression") {
		return node.typeParameters?.params.length
			? null
			: classifyFunction(node, environment, sourceCode, substitutions);
	}
	if (node.type === "ObjectExpression") {
		for (const property of node.properties) {
			if (property.type !== "Property" || property.kind !== "init") continue;
			const unsafe = classifyExpression(property.value, environment, sourceCode, substitutions);
			if (unsafe !== null) return unsafe;
		}
	}
	return null;
}

function classifyFunction(
	node: ESTree.Function | ESTree.ArrowFunctionExpression,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	substitutions: TypeAliasEnvironment,
): UnsafeDictionary | null {
	if (node.returnType != null)
		return classifyUnsafeMap(node.returnType.typeAnnotation, environment, substitutions);
	if (node.body === null) return null;
	if (node.body.type !== "BlockStatement")
		return classifyExpression(node.body, environment, sourceCode, substitutions);
	if (node.body.body.length !== 1) return null;
	const [statement] = node.body.body;
	return statement.type === "ReturnStatement" && statement.argument !== null
		? classifyExpression(statement.argument, environment, sourceCode, substitutions)
		: null;
}

function classifyClass(
	node: ESTree.Class,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	substitutions: TypeAliasEnvironment,
	visited: ReadonlySet<ESTree.Node>,
): UnsafeDictionary | null {
	if (node.superClass !== null && isMapConstructor(node.superClass, environment, sourceCode)) {
		const value = node.superTypeArguments?.params[1];
		if (value !== undefined) {
			const unsafe = classifyUnsafeDictionaryValue(value, environment, substitutions);
			if (unsafe !== null) return unsafe;
		}
	} else if (node.superClass !== null) {
		const unsafe = classifyLocalMapApplication(
			node.superClass,
			{ typeArguments: node.superTypeArguments },
			environment,
			sourceCode,
			false,
			substitutions,
			visited,
		);
		if (unsafe !== null) return unsafe;
	}
	for (const member of node.body.body) {
		if (member.type === "PropertyDefinition" && !member.static) {
			const unsafe =
				member.typeAnnotation != null
					? classifyUnsafeMap(member.typeAnnotation.typeAnnotation, environment, substitutions)
					: member.value === null
						? null
						: classifyExpression(member.value, environment, sourceCode, substitutions);
			if (unsafe !== null) return unsafe;
		}
		if (member.type === "MethodDefinition" && member.kind === "constructor") {
			for (const parameter of member.value.params) {
				if (parameter.type !== "TSParameterProperty") continue;
				const annotation = parameter.parameter.typeAnnotation?.typeAnnotation;
				if (annotation == null) continue;
				const unsafe = classifyUnsafeMap(annotation, environment, substitutions);
				if (unsafe !== null) return unsafe;
			}
		}
	}
	return null;
}

export function classifyLocalMapApplication(
	expression: ESTree.Node,
	application: Pick<ESTree.NewExpression, "typeArguments">,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	allowUnbound = false,
	base: TypeAliasEnvironment = new Map(),
	visited: ReadonlySet<ESTree.Node> = new Set(),
): UnsafeDictionary | null {
	const source = resolveSource(expression, environment, sourceCode);
	if (source === null || source.path.length !== 0) return null;
	const node = source.node;
	if (visited.has(node)) return null;
	if (
		node.type !== "ClassDeclaration" &&
		node.type !== "ClassExpression" &&
		node.type !== "FunctionDeclaration" &&
		node.type !== "FunctionExpression" &&
		node.type !== "ArrowFunctionExpression"
	)
		return null;
	if (!node.typeParameters?.params.length) return null;
	const inferMissingArguments = allowUnbound && !application.typeArguments?.params.length;
	if (
		inferMissingArguments &&
		(("params" in node && node.params.length > 0) ||
			((node.type === "ClassDeclaration" || node.type === "ClassExpression") &&
				node.body.body.some(
					(member) =>
						member.type === "MethodDefinition" &&
						member.kind === "constructor" &&
						member.value.params.length > 0,
				)))
	)
		return null;
	const resolved = aliasSubstitution(node, application, base, inferMissingArguments);
	if (resolved === null) return null;
	const substitutions = new Map(resolved);
	const unbound = new Set(environment.unboundTypeParameters);
	if (allowUnbound) {
		for (const parameter of node.typeParameters.params) {
			if (substitutions.has(parameter.name.name)) continue;
			if (parameter.constraint != null)
				substitutions.set(parameter.name.name, parameter.constraint);
			else unbound.add(parameter.name.name);
		}
	}
	const instantiated =
		unbound.size === 0 ? environment : { ...environment, unboundTypeParameters: unbound };
	const nextVisited = new Set(visited).add(node);
	if (node.type === "ClassDeclaration" || node.type === "ClassExpression")
		return classifyClass(node, instantiated, sourceCode, substitutions, nextVisited);
	if (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	)
		return classifyFunction(node, instantiated, sourceCode, substitutions);
	return null;
}
