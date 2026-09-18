import type { ESTree, Scope, SourceCode, Variable } from "@oxlint/plugins";
import type { TypeEnvironment } from "./dictionary-types.ts";

type PropertyPath = readonly (string | number)[];
type ValueSource = { readonly node: ESTree.Node; readonly path: PropertyPath };

export function resolveVariable(
	node: Extract<ESTree.Node, { type: "Identifier" }>,
	sourceCode: SourceCode,
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(node);
	while (scope !== null) {
		const variable = scope.set.get(node.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

function propertyKey(node: ESTree.PropertyKey, computed: boolean): string | number | null {
	if (!computed && node.type === "Identifier") return node.name;
	return node.type === "Literal" &&
		(typeof node.value === "string" || typeof node.value === "number")
		? node.value
		: null;
}

function hasStableProjections(variable: Variable): boolean {
	return variable.references.every((reference) => {
		if (reference.init) return true;
		let node: ESTree.Node = reference.identifier;
		while (node.parent.type === "MemberExpression" && node.parent.object === node)
			node = node.parent;
		const parent = node.parent;
		if (node === reference.identifier) {
			return (
				parent.type === "VariableDeclarator" &&
				parent.init === node &&
				parent.id.type !== "Identifier"
			);
		}
		return !(
			(parent.type === "AssignmentExpression" && parent.left === node) ||
			parent.type === "UpdateExpression" ||
			(parent.type === "UnaryExpression" && parent.operator === "delete") ||
			(parent.type === "CallExpression" && parent.callee === node)
		);
	});
}

function isStraightLineQuery(node: ESTree.Node): boolean {
	let owner = node;
	while (true) {
		if (owner.type === "BlockStatement" || owner.type === "Program") {
			if (
				owner.body.some(
					(statement) =>
						statement.type === "IfStatement" ||
						statement.type === "SwitchStatement" ||
						statement.type === "TryStatement" ||
						statement.type === "ForStatement" ||
						statement.type === "ForInStatement" ||
						statement.type === "ForOfStatement" ||
						statement.type === "WhileStatement" ||
						statement.type === "DoWhileStatement" ||
						statement.type === "ExpressionStatement" ||
						statement.type === "LabeledStatement",
				)
			)
				return false;
		}
		if (
			owner.type === "ConditionalExpression" ||
			owner.type === "LogicalExpression" ||
			owner.type === "SequenceExpression"
		)
			return false;
		if (owner.type === "Program") return true;
		owner = owner.parent;
	}
}

function bindingPath(
	pattern: ESTree.BindingPattern,
	name: string,
	tail: PropertyPath = [],
): PropertyPath | null {
	if (pattern.type === "Identifier") return pattern.name === name ? tail : null;
	if (pattern.type === "ObjectPattern") {
		for (const property of pattern.properties) {
			if (property.type === "RestElement") {
				const rest = bindingPath(property.argument, name, tail);
				if (rest === null || rest.length === 0) continue;
				const excluded = pattern.properties
					.filter((member) => member.type === "Property")
					.map((member) => propertyKey(member.key, member.computed));
				return excluded.includes(null) || excluded.includes(rest[0]) ? null : rest;
			}
			const key = propertyKey(property.key, property.computed);
			const rest = bindingPath(property.value, name, tail);
			if (key !== null && rest !== null) return [key, ...rest];
		}
	}
	if (pattern.type === "ArrayPattern") {
		for (const [index, element] of pattern.elements.entries()) {
			if (element === null) continue;
			if (element.type === "RestElement") {
				const rest = bindingPath(element.argument, name, tail);
				if (rest === null || typeof rest[0] !== "number") continue;
				return [index + rest[0], ...rest.slice(1)];
			}
			const rest = bindingPath(element, name, tail);
			if (rest !== null) return [index, ...rest];
		}
	}
	return null;
}

export function resolveSource(
	node: ESTree.Node,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	path: PropertyPath = [],
	visited = new Set<ESTree.Node>(),
): ValueSource | null {
	if (visited.has(node)) return null;
	const nextVisited = new Set(visited).add(node);
	const resolve = (source: ESTree.Node, nextPath = path) =>
		resolveSource(source, environment, sourceCode, nextPath, nextVisited);
	if (node.type === "Identifier") {
		const variable = resolveVariable(node, sourceCode);
		if (variable === null || variable.defs.length === 0) return { node, path };
		if (variable.defs.length !== 1) return null;
		const [definition] = variable.defs;
		if (
			definition.type === "Variable" &&
			definition.node.type === "VariableDeclarator" &&
			definition.node.init !== null &&
			definition.parent?.type === "VariableDeclaration" &&
			definition.parent.kind === "const"
		) {
			const projection = bindingPath(definition.node.id, node.name, path);
			if (
				path.length > 0 &&
				definition.node.id.type === "Identifier" &&
				!hasStableProjections(variable)
			)
				return null;
			return projection === null ? null : resolve(definition.node.init, projection);
		}
		if (definition.type === "FunctionName" || definition.type === "ClassName")
			return { node: definition.node, path };
		if (definition.type === "Parameter") {
			const parameter = parameterSource(variable, node.name, path);
			return parameter === null ? null : resolve(parameter.type, parameter.path);
		}
		return null;
	}
	if (node.type === "MemberExpression") {
		const key = propertyKey(node.property, node.computed);
		return key === null ? null : resolve(node.object, [key, ...path]);
	}
	if (node.type === "TSTypeQuery") return resolve(node.exprName);
	if (node.type === "TSQualifiedName") return resolve(node.left, [node.right.name, ...path]);
	if (
		node.type === "TSTypeReference" &&
		node.typeName.type === "Identifier" &&
		!node.typeArguments?.params.length
	) {
		const alias = environment.aliases.get(node.typeName.name);
		return alias === undefined || alias.typeParameters?.params.length
			? null
			: resolve(alias.typeAnnotation);
	}
	if (path.length === 0) return { node, path };
	const [key, ...rest] = path;
	if (node.type === "ObjectExpression") {
		if (node.properties.some((property) => property.type === "SpreadElement" || property.computed))
			return null;
		const property = [...node.properties]
			.reverse()
			.find(
				(property) =>
					property.type === "Property" && propertyKey(property.key, property.computed) === key,
			);
		return property?.type === "Property" && property.kind === "init"
			? resolve(property.value, rest)
			: null;
	}
	if (
		node.type === "ArrayExpression" &&
		typeof key === "number" &&
		!node.elements.some((element) => element?.type === "SpreadElement")
	) {
		const element = node.elements[key];
		return element == null ? null : resolve(element, rest);
	}
	return null;
}

function parameterSource(
	variable: Variable,
	name: string,
	path: PropertyPath,
): { type: ESTree.TSType; path: PropertyPath } | null {
	const declaration = variable.defs[0]?.node;
	if (
		declaration?.type !== "FunctionDeclaration" &&
		declaration?.type !== "FunctionExpression" &&
		declaration?.type !== "ArrowFunctionExpression"
	)
		return null;
	for (const entry of declaration.params) {
		const parameter = entry.type === "TSParameterProperty" ? entry.parameter : entry;
		const pattern = parameter.type === "RestElement" ? parameter.argument : parameter;
		const projection = bindingPath(pattern, name, path);
		const annotation =
			parameter.typeAnnotation?.typeAnnotation ?? pattern.typeAnnotation?.typeAnnotation;
		if (projection !== null && annotation != null) return { type: annotation, path: projection };
	}
	return null;
}

function projectType(
	type: ESTree.TSType,
	path: PropertyPath,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	visited: Set<ESTree.Node>,
): ESTree.TSType | null {
	if (visited.has(type)) return null;
	const nextVisited = new Set(visited).add(type);
	if (type.type === "TSTypeQuery")
		return resolveDeclaredType(type.exprName, environment, sourceCode, path, nextVisited);
	if (path.length === 0) return type;
	if (
		type.type === "TSParenthesizedType" ||
		(type.type === "TSTypeOperator" && type.operator === "readonly")
	)
		return projectType(type.typeAnnotation, path, environment, sourceCode, nextVisited);
	if (
		type.type === "TSTypeReference" &&
		type.typeName.type === "Identifier" &&
		!type.typeArguments?.params.length
	) {
		const name = type.typeName.name;
		let owner = type.parent;
		while (owner.type !== "Program") {
			if ("typeParameters" in owner) {
				const parameter = owner.typeParameters?.params.find(
					(parameter) => parameter.name.name === name,
				);
				if (parameter !== undefined)
					return parameter.constraint == null
						? null
						: projectType(parameter.constraint, path, environment, sourceCode, nextVisited);
			}
			owner = owner.parent;
		}
		const alias = environment.aliases.get(type.typeName.name);
		return alias === undefined || alias.typeParameters?.params.length
			? null
			: projectType(alias.typeAnnotation, path, environment, sourceCode, nextVisited);
	}
	const [key, ...rest] = path;
	if (type.type === "TSTypeLiteral") {
		const property = type.members.find(
			(member) =>
				member.type === "TSPropertySignature" && propertyKey(member.key, member.computed) === key,
		);
		return property?.type === "TSPropertySignature" && property.typeAnnotation != null
			? projectType(
					property.typeAnnotation.typeAnnotation,
					rest,
					environment,
					sourceCode,
					nextVisited,
				)
			: null;
	}
	if (
		type.type === "TSTupleType" &&
		typeof key === "number" &&
		!type.elementTypes.some((element) => element.type === "TSRestType")
	) {
		const element = type.elementTypes[key];
		if (element === undefined) return null;
		const value = element.type === "TSNamedTupleMember" ? element.elementType : element;
		return value.type === "TSOptionalType" || value.type === "TSRestType"
			? null
			: projectType(value, rest, environment, sourceCode, nextVisited);
	}
	return null;
}

export function resolveDeclaredType(
	node: ESTree.Node,
	environment: TypeEnvironment,
	sourceCode: SourceCode,
	path: PropertyPath = [],
	visited = new Set<ESTree.Node>(),
): ESTree.TSType | null {
	if (visited.size === 0 && !isStraightLineQuery(node)) return null;
	if (visited.has(node)) return null;
	const nextVisited = new Set(visited).add(node);
	if (node.type === "TSQualifiedName")
		return resolveDeclaredType(
			node.left,
			environment,
			sourceCode,
			[node.right.name, ...path],
			nextVisited,
		);
	if (node.type === "MemberExpression") {
		const key = propertyKey(node.property, node.computed);
		return key === null
			? null
			: resolveDeclaredType(node.object, environment, sourceCode, [key, ...path], nextVisited);
	}
	if (node.type !== "Identifier") return null;
	const variable = resolveVariable(node, sourceCode);
	if (variable === null || variable.defs.length !== 1) return null;
	if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
	const [definition] = variable.defs;
	if (definition.type === "Parameter") {
		const parameter = parameterSource(variable, node.name, path);
		return parameter === null
			? null
			: projectType(parameter.type, parameter.path, environment, sourceCode, nextVisited);
	}
	if (definition.type !== "Variable" || definition.node.type !== "VariableDeclarator") return null;
	const projection = bindingPath(definition.node.id, node.name, path);
	if (projection === null) return null;
	const annotation = definition.node.id.typeAnnotation?.typeAnnotation;
	if (annotation != null)
		return projectType(annotation, projection, environment, sourceCode, nextVisited);
	return definition.node.init === null
		? null
		: resolveDeclaredType(definition.node.init, environment, sourceCode, projection, nextVisited);
}
