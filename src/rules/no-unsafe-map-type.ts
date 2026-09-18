import { defineRule } from "@oxlint/plugins";

import {
	classifyUnsafeDictionaryValue,
	classifyUnsafeDefaults,
	isReportedDefaultReference,
	classifyUnsafeMap,
	createTypeEnvironment,
	type TypeEnvironment,
} from "../shared/dictionary-types.ts";

import { classifyLocalMapApplication, isMapConstructor } from "../shared/local-map-contracts.ts";

import type { ESTree } from "@oxlint/plugins";

function hasNoContextualContract(node: ESTree.NewExpression | ESTree.CallExpression): boolean {
	const parent = node.parent;
	if (parent.type === "VariableDeclarator") return parent.id.typeAnnotation == null;
	if (parent.type === "PropertyDefinition") return parent.typeAnnotation == null;
	if (parent.type === "ArrowFunctionExpression" && parent.returnType == null) {
		return parent.parent.type === "VariableDeclarator" && parent.parent.id.typeAnnotation == null;
	}
	if (parent.type === "ReturnStatement") {
		let owner = parent.parent;
		while (owner.type !== "Program") {
			if (owner.type === "FunctionDeclaration") return owner.returnType == null;
			if (owner.type === "FunctionExpression" || owner.type === "ArrowFunctionExpression")
				return false;
			owner = owner.parent;
		}
	}
	return parent.type === "ExpressionStatement" || parent.type === "ExportDefaultDeclaration";
}

function hasNoEntries(node: ESTree.NewExpression): boolean {
	if (node.arguments.length === 0) return true;
	if (node.arguments.length !== 1) return false;
	const [entries] = node.arguments;
	return (
		(entries.type === "ArrayExpression" && entries.elements.length === 0) ||
		(entries.type === "Literal" && entries.value === null)
	);
}

function isPlainAliasConsumer(node: ESTree.TSTypeReference, environment: TypeEnvironment): boolean {
	if (node.typeName.type !== "Identifier" || node.typeArguments?.params.length) return false;
	const alias = environment.aliases.get(node.typeName.name);
	if (alias === undefined || alias.typeParameters?.params.length) return false;
	let parent = node.parent;
	while (parent.type !== "Program") {
		if (parent.type === "TSTypeAliasDeclaration") return false;
		parent = parent.parent;
	}
	return true;
}

export const noUnsafeMapTypeRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Require concrete Map and ReadonlyMap value contracts; reject untyped standalone empty Map construction.",
		},
		messages: {
			unsafeMap:
				"This map's {{value}} value type gives callers no concrete value contract. Use an owner/schema-derived value type.",
			untypedMap:
				"This empty Map has no concrete value contract. Supply type arguments or a contextual type annotation.",
		},
	},
	createOnce(context) {
		let environment: TypeEnvironment | null = null;
		const inspectArguments = (
			node: ESTree.Node,
			arguments_: ESTree.TSTypeParameterInstantiation | null | undefined,
		) => {
			const value = arguments_?.params[1];
			if (environment === null || value === undefined) return;
			const unsafe = classifyUnsafeDictionaryValue(value, environment);
			if (unsafe !== null)
				context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
		};
		const inspectClass = (
			node: Extract<ESTree.Node, { type: "ClassDeclaration" | "ClassExpression" }>,
		) => {
			if (
				node.superClass !== null &&
				environment !== null &&
				isMapConstructor(node.superClass, environment, context.sourceCode)
			) {
				inspectArguments(node, node.superTypeArguments);
			} else if (node.superClass !== null && environment !== null) {
				const unsafe = classifyLocalMapApplication(
					node.superClass,
					{ typeArguments: node.superTypeArguments },
					environment,
					context.sourceCode,
				);
				if (unsafe !== null)
					context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
			}
		};
		const inspectDefaults = (
			node: ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration,
		) => {
			if (environment === null) return;
			const unsafe = classifyUnsafeDefaults(node, environment, "map");
			if (unsafe !== null)
				context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
		};
		return {
			TSTypeAliasDeclaration: inspectDefaults,
			TSInterfaceDeclaration: inspectDefaults,
			Program(node) {
				environment = createTypeEnvironment(node, context.sourceCode);
			},
			TSTypeReference(node) {
				if (environment === null || isPlainAliasConsumer(node, environment)) return;
				if (isReportedDefaultReference(node, environment, "map")) return;
				const unsafe =
					classifyUnsafeMap(node, environment) ??
					classifyLocalMapApplication(node.typeName, node, environment, context.sourceCode);
				if (unsafe === null) return;
				let parent = node.parent;
				while (parent.type !== "Program") {
					if (
						(parent.type === "TSTypeReference" || parent.type === "TSInterfaceHeritage") &&
						classifyUnsafeMap(parent, environment) !== null
					)
						return;
					parent = parent.parent;
				}
				context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
			},
			NewExpression(node) {
				if (environment === null) return;
				if (!isMapConstructor(node.callee, environment, context.sourceCode)) {
					const unsafe = classifyLocalMapApplication(
						node.callee,
						node,
						environment,
						context.sourceCode,
						node.arguments.length === 0 && hasNoContextualContract(node),
					);
					if (unsafe !== null)
						context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
					return;
				}
				inspectArguments(node, node.typeArguments);
				if (
					/\.(?:[cm]?ts|tsx)$/i.test(context.filename) &&
					!node.typeArguments?.params.length &&
					hasNoEntries(node) &&
					hasNoContextualContract(node)
				) {
					context.report({ node, messageId: "untypedMap" });
				}
			},
			CallExpression(node) {
				if (environment === null) return;
				if (isMapConstructor(node.callee, environment, context.sourceCode))
					inspectArguments(node, node.typeArguments);
				else {
					const unsafe = classifyLocalMapApplication(
						node.callee,
						node,
						environment,
						context.sourceCode,
						node.arguments.length === 0 && hasNoContextualContract(node),
					);
					if (unsafe !== null)
						context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
				}
			},
			ClassDeclaration: inspectClass,
			ClassExpression: inspectClass,
			TSInterfaceHeritage(node) {
				if (environment === null) return;
				const unsafe = classifyUnsafeMap(node, environment);
				if (unsafe !== null)
					context.report({ node, messageId: "unsafeMap", data: { value: unsafe.unsafeValue } });
			},
		};
	},
});
