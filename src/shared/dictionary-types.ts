import { resolveDeclaredType, resolveVariable } from "./local-bindings.ts";

import type { ESTree, SourceCode } from "@oxlint/plugins";

const BUILT_INS = new Set([
	"Record",
	"Map",
	"ReadonlyMap",
	"Object",
	"Readonly",
	"Partial",
	"Required",
	"Pick",
	"Omit",
	"PropertyKey",
	"NonNullable",
	"NoInfer",
	"Awaited",
	"Array",
	"ReadonlyArray",
]);
const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable", "NoInfer"]);

export type TypeAliasEnvironment = ReadonlyMap<string, ESTree.TSType>;

type ResolvedType = {
	readonly type: ESTree.TSType;
	readonly substitutions: TypeAliasEnvironment;
};

export type UnsafeDictionary = {
	readonly kind: "unsafe-dictionary";
	readonly unsafeValue: "any" | "empty-object" | "object" | "union" | "unknown";
};

export type WideningTargetKind = "generic container" | "object" | "open dictionary" | "unknown";

export type WideningTarget = {
	readonly kind: WideningTargetKind;
};

export type TypeEnvironment = {
	readonly sourceCode?: SourceCode;
	readonly unboundTypeParameters?: ReadonlySet<string>;
	readonly aliases: ReadonlyMap<string, ESTree.TSTypeAliasDeclaration>;
	readonly interfaces: ReadonlyMap<string, readonly ESTree.TSInterfaceDeclaration[]>;
	readonly shadowedBuiltIns: ReadonlySet<string>;
};

function declaredStatement(statement: ESTree.Statement): ESTree.Node | null {
	return statement.type === "ExportNamedDeclaration" ||
		statement.type === "ExportDefaultDeclaration"
		? (statement.declaration ?? null)
		: statement;
}

export function createTypeEnvironment(
	program: ESTree.Program,
	sourceCode?: SourceCode,
): TypeEnvironment {
	const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
	const interfaces = new Map<string, ESTree.TSInterfaceDeclaration[]>();
	const shadowedBuiltIns = new Set<string>();

	for (const statement of program.body) {
		const declaration = declaredStatement(statement);
		if (declaration?.type === "ImportDeclaration") {
			for (const specifier of declaration.specifiers) {
				if (BUILT_INS.has(specifier.local.name)) shadowedBuiltIns.add(specifier.local.name);
			}
			continue;
		}

		if (declaration?.type === "TSTypeAliasDeclaration") {
			const existing = aliases.get(declaration.id.name);
			if (existing === undefined) aliases.set(declaration.id.name, declaration);
			else shadowedBuiltIns.add(declaration.id.name);
			if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
			continue;
		}

		if (declaration?.type === "TSInterfaceDeclaration") {
			const declarations = interfaces.get(declaration.id.name) ?? [];
			declarations.push(declaration);
			interfaces.set(declaration.id.name, declarations);
			if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
			continue;
		}

		if (declaration?.type === "TSEnumDeclaration") {
			if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
			continue;
		}

		if (
			(declaration?.type === "ClassDeclaration" || declaration?.type === "FunctionDeclaration") &&
			declaration.id !== null
		) {
			if (BUILT_INS.has(declaration.id.name)) shadowedBuiltIns.add(declaration.id.name);
		}
	}

	return { aliases, interfaces, shadowedBuiltIns, sourceCode };
}

function typeReferenceName(type: ESTree.TSTypeReference): string | null {
	return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function isBuiltIn(name: string, environment: TypeEnvironment): boolean {
	return BUILT_INS.has(name) && !environment.shadowedBuiltIns.has(name);
}

function isUntrackedTypeBinding(
	node: Extract<ESTree.Node, { type: "Identifier" }>,
	environment: TypeEnvironment,
): boolean {
	if (environment.sourceCode === undefined) return false;
	const variable = resolveVariable(node, environment.sourceCode);
	return (
		variable?.defs.some((definition) => {
			const declaration = definition.node;
			if (declaration.type === "TSTypeParameter") return true;
			if (declaration.type === "TSTypeAliasDeclaration")
				return environment.aliases.get(node.name) !== declaration;
			if (declaration.type === "TSInterfaceDeclaration")
				return !environment.interfaces.get(node.name)?.includes(declaration);
			return declaration.type === "ClassDeclaration" || declaration.type === "ClassExpression";
		}) ?? false
	);
}

function isUnappliedReferenceTo(type: ESTree.TSType, name: string): boolean {
	const unwrapped = unwrapTransparentType(type);
	return (
		unwrapped.type === "TSTypeReference" &&
		typeReferenceName(unwrapped) === name &&
		(unwrapped.typeArguments === null ||
			unwrapped.typeArguments === undefined ||
			unwrapped.typeArguments.params.length === 0)
	);
}

function unwrapTransparentType(type: ESTree.TSType): ESTree.TSType {
	let current = type;
	while (
		current.type === "TSParenthesizedType" ||
		(current.type === "TSTypeOperator" && current.operator === "readonly")
	) {
		current = current.typeAnnotation;
	}
	return current;
}

function isNeverType(type: ESTree.TSType): boolean {
	return unwrapTransparentType(type).type === "TSNeverKeyword";
}

function isEffectivelyEmptyMember(member: ESTree.TSSignature): boolean {
	return (
		member.type === "TSPropertySignature" &&
		member.optional === true &&
		member.typeAnnotation !== null &&
		member.typeAnnotation !== undefined &&
		isNeverType(member.typeAnnotation.typeAnnotation)
	);
}

function isEffectivelyEmptyTypeLiteral(type: ESTree.TSTypeLiteral): boolean {
	return type.members.length === 0 || type.members.every(isEffectivelyEmptyMember);
}

function isEffectivelyEmptyInterface(
	declarations: readonly ESTree.TSInterfaceDeclaration[],
): boolean {
	if (declarations.length !== 1) return false;
	const [type] = declarations;
	return (
		type !== undefined &&
		type.extends.length === 0 &&
		(type.body.body.length === 0 || type.body.body.every(isEffectivelyEmptyMember))
	);
}

function resolvedSubstitutionArgument(
	type: ESTree.TSType,
	base: TypeAliasEnvironment,
	resolving: ReadonlySet<string> = new Set(),
): ESTree.TSType {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type !== "TSTypeReference") return type;
	const name = typeReferenceName(unwrapped);
	if (name === null || resolving.has(name)) return type;
	const substitution = base.get(name);
	if (substitution === undefined) return type;
	const nextResolving = new Set(resolving);
	nextResolving.add(name);
	return resolvedSubstitutionArgument(substitution, base, nextResolving);
}

export function aliasSubstitution(
	alias: Pick<ESTree.Function, "typeParameters">,
	type: Pick<ESTree.NewExpression, "typeArguments">,
	base: TypeAliasEnvironment,
	allowUnbound = false,
): TypeAliasEnvironment | null {
	const parameters = alias.typeParameters?.params ?? [];
	const arguments_ = type.typeArguments?.params ?? [];
	const next = new Map(base);
	for (const [index, parameter] of parameters.entries()) {
		const argument = arguments_[index] ?? parameter.default;
		if (argument === null || argument === undefined) {
			if (allowUnbound) continue;
			return null;
		}
		next.set(parameter.name.name, resolvedSubstitutionArgument(argument, next));
	}
	return next;
}

function unsafeDirectValue(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): UnsafeDictionary["unsafeValue"] | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return "unknown";
	if (unwrapped.type === "TSAnyKeyword") return "any";
	if (unwrapped.type === "TSObjectKeyword") return "object";
	if (unwrapped.type === "TSTypeLiteral" && isEffectivelyEmptyTypeLiteral(unwrapped))
		return "empty-object";
	if (unwrapped.type === "TSIndexedAccessType") {
		const member = indexedMember(unwrapped, environment);
		return member === null
			? null
			: unsafeDirectValue(member, environment, substitutions, resolvingAliases);
	}
	if (unwrapped.type === "TSTypeQuery" && environment.sourceCode !== undefined) {
		const value = resolveDeclaredType(unwrapped.exprName, environment, environment.sourceCode);
		return value === null
			? null
			: unsafeDirectValue(value, environment, substitutions, resolvingAliases);
	}
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.some(
			(member) => unsafeDirectValue(member, environment, substitutions, resolvingAliases) !== null,
		)
			? "union"
			: null;
	}
	if (unwrapped.type === "TSIntersectionType") {
		const unsafeMembers = unwrapped.types.map((member) =>
			unsafeDirectValue(member, environment, substitutions, resolvingAliases),
		);
		if (unsafeMembers.includes("any")) return "any";
		return unsafeMembers.length > 0 && unsafeMembers.every((member) => member !== null)
			? unsafeMembers[0]
			: null;
	}
	if (unwrapped.type !== "TSTypeReference") return null;
	const name = typeReferenceName(unwrapped);
	if (name === null) return null;
	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		const remaining = new Map(substitutions);
		remaining.delete(name);
		return isUnappliedReferenceTo(substitution, name)
			? environment.unboundTypeParameters?.has(name)
				? "unknown"
				: null
			: unsafeDirectValue(substitution, environment, remaining, resolvingAliases);
	}
	if (environment.unboundTypeParameters?.has(name)) return "unknown";
	if (
		unwrapped.typeName.type === "Identifier" &&
		isUntrackedTypeBinding(unwrapped.typeName, environment)
	)
		return null;
	if (name === "Object" && isBuiltIn(name, environment)) return "object";
	if (name === "Awaited" && isBuiltIn(name, environment)) {
		const value = unwrapped.typeArguments?.params[0];
		if (value === undefined) return null;
		const unsafe = unsafeDirectValue(value, environment, substitutions, resolvingAliases);
		return unsafe === "unknown" || unsafe === "any" ? unsafe : null;
	}
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined
			? null
			: unsafeDirectValue(wrapped, environment, substitutions, resolvingAliases);
	}
	const interfaceDeclarations = environment.interfaces.get(name);
	if (interfaceDeclarations !== undefined) {
		return isEffectivelyEmptyInterface(interfaceDeclarations) ? "empty-object" : null;
	}
	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return null;
	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) return null;
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return unsafeDirectValue(alias.typeAnnotation, environment, nextSubstitutions, nextResolving);
}

function dictionaryValueTypes(
	type: ESTree.TSType | ESTree.TSInterfaceHeritage,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
	container: "dictionary" | "map" = "dictionary",
): readonly ResolvedType[] {
	const unwrapped = type.type === "TSInterfaceHeritage" ? type : unwrapTransparentType(type);

	if (container === "dictionary" && unwrapped.type === "TSTypeLiteral") {
		return unwrapped.members.flatMap((member): readonly ResolvedType[] =>
			member.type === "TSIndexSignature" && member.typeAnnotation !== null
				? [{ type: member.typeAnnotation.typeAnnotation, substitutions }]
				: member.type === "TSPropertySignature" && member.typeAnnotation != null
					? dictionaryValueTypes(
							member.typeAnnotation.typeAnnotation,
							environment,
							substitutions,
							resolvingAliases,
							container,
						)
					: [],
		);
	}
	if (container === "map" && unwrapped.type === "TSTypeLiteral") {
		return unwrapped.members.flatMap((member) =>
			(member.type === "TSPropertySignature" || member.type === "TSIndexSignature") &&
			member.typeAnnotation != null
				? dictionaryValueTypes(
						member.typeAnnotation.typeAnnotation,
						environment,
						substitutions,
						resolvingAliases,
						container,
					)
				: [],
		);
	}
	if (unwrapped.type === "TSArrayType") {
		return dictionaryValueTypes(
			unwrapped.elementType,
			environment,
			substitutions,
			resolvingAliases,
			container,
		);
	}
	if (unwrapped.type === "TSIndexedAccessType") {
		const member = indexedMember(unwrapped, environment);
		return member === null
			? []
			: dictionaryValueTypes(member, environment, substitutions, resolvingAliases, container);
	}

	if (container === "dictionary" && unwrapped.type === "TSMappedType") {
		return unwrapped.typeAnnotation === null
			? []
			: [{ type: unwrapped.typeAnnotation, substitutions }];
	}

	if (
		container === "map" &&
		(unwrapped.type === "TSUnionType" || unwrapped.type === "TSIntersectionType")
	) {
		return unwrapped.types.flatMap((member) =>
			dictionaryValueTypes(member, environment, substitutions, resolvingAliases, container),
		);
	}

	if (unwrapped.type !== "TSTypeReference" && unwrapped.type !== "TSInterfaceHeritage") return [];
	const typeName =
		unwrapped.type === "TSInterfaceHeritage" ? unwrapped.expression : unwrapped.typeName;
	if (typeName.type !== "Identifier") return [];
	const name = typeName.name;

	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		const remaining = new Map(substitutions);
		remaining.delete(name);
		return isUnappliedReferenceTo(substitution, name)
			? []
			: dictionaryValueTypes(substitution, environment, remaining, resolvingAliases, container);
	}
	if (isUntrackedTypeBinding(typeName, environment)) return [];

	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined
			? []
			: dictionaryValueTypes(wrapped, environment, substitutions, resolvingAliases, container);
	}

	const matchesContainer =
		container === "dictionary" ? name === "Record" : name === "Map" || name === "ReadonlyMap";
	if (matchesContainer && isBuiltIn(name, environment)) {
		const value = unwrapped.typeArguments?.params[1] ?? null;
		return value === null ? [] : [{ type: value, substitutions }];
	}

	if ((name === "Array" || name === "ReadonlyArray") && isBuiltIn(name, environment)) {
		const item = unwrapped.typeArguments?.params[0];
		return item === undefined
			? []
			: dictionaryValueTypes(item, environment, substitutions, resolvingAliases, container);
	}
	if (
		(name === "Record" || name === "Map" || name === "ReadonlyMap") &&
		isBuiltIn(name, environment)
	) {
		const value = unwrapped.typeArguments?.params[1];
		return value === undefined
			? []
			: dictionaryValueTypes(value, environment, substitutions, resolvingAliases, container);
	}
	if (
		container === "dictionary" &&
		(name === "Pick" || name === "Omit") &&
		isBuiltIn(name, environment)
	) {
		const source = unwrapped.typeArguments?.params[0];
		return source === undefined
			? []
			: dictionaryValueTypes(source, environment, substitutions, resolvingAliases, container);
	}

	const interfaces = environment.interfaces.get(name);
	if (interfaces !== undefined) {
		if (resolvingAliases.has(name)) return [];
		const nextResolving = new Set(resolvingAliases);
		nextResolving.add(name);
		return interfaces.flatMap((declaration) => {
			const nextSubstitutions = aliasSubstitution(declaration, unwrapped, substitutions);
			if (nextSubstitutions === null) return [];
			const ownValues = declaration.body.body.flatMap((member): readonly ResolvedType[] =>
				container === "dictionary" &&
				member.type === "TSIndexSignature" &&
				member.typeAnnotation !== null
					? [{ type: member.typeAnnotation.typeAnnotation, substitutions: nextSubstitutions }]
					: [],
			);
			const inheritedValues = declaration.extends.flatMap((heritage) =>
				dictionaryValueTypes(heritage, environment, nextSubstitutions, nextResolving, container),
			);
			return [...ownValues, ...inheritedValues];
		});
	}

	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return [];
	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) return [];
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return dictionaryValueTypes(
		alias.typeAnnotation,
		environment,
		nextSubstitutions,
		nextResolving,
		container,
	);
}

export function classifyUnsafeDictionaryValue(
	valueType: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment = new Map(),
): UnsafeDictionary | null {
	const unsafeValue = unsafeDirectValue(valueType, environment, substitutions, new Set());
	return unsafeValue === null ? null : { kind: "unsafe-dictionary", unsafeValue };
}

function classifyUnsafeContainer(
	type: ESTree.TSType | ESTree.TSInterfaceHeritage,
	environment: TypeEnvironment,
	container: "dictionary" | "map",
	substitutions: TypeAliasEnvironment = new Map(),
): UnsafeDictionary | null {
	for (const valueType of dictionaryValueTypes(
		type,
		environment,
		substitutions,
		new Set(),
		container,
	)) {
		const unsafeValue = unsafeDirectValue(
			valueType.type,
			environment,
			valueType.substitutions,
			new Set(),
		);
		if (unsafeValue !== null) return { kind: "unsafe-dictionary", unsafeValue };
	}
	return null;
}

export function classifyUnsafeDictionary(
	type: ESTree.TSType | ESTree.TSInterfaceHeritage,
	environment: TypeEnvironment,
	substitutions?: TypeAliasEnvironment,
): UnsafeDictionary | null {
	return classifyUnsafeContainer(type, environment, "dictionary", substitutions);
}

export function classifyUnsafeMap(
	type: ESTree.TSType | ESTree.TSInterfaceHeritage,
	environment: TypeEnvironment,
	substitutions?: TypeAliasEnvironment,
): UnsafeDictionary | null {
	return classifyUnsafeContainer(type, environment, "map", substitutions);
}

function indexedMember(
	type: ESTree.TSIndexedAccessType,
	environment: TypeEnvironment,
): ESTree.TSType | null {
	let object = unwrapTransparentType(type.objectType);
	if (object.type === "TSTypeQuery" && environment.sourceCode !== undefined) {
		const resolved = resolveDeclaredType(object.exprName, environment, environment.sourceCode);
		if (resolved === null) return null;
		object = unwrapTransparentType(resolved);
	}
	const index = unwrapTransparentType(type.indexType);
	if (index.type !== "TSLiteralType" || index.literal.type !== "Literal") return null;
	const key = index.literal.value;
	if (
		object.type === "TSTupleType" &&
		typeof key === "number" &&
		Number.isInteger(key) &&
		key >= 0
	) {
		const member = object.elementTypes[key];
		if (
			member === undefined ||
			object.elementTypes.some((element) => element.type === "TSRestType")
		)
			return null;
		const value = member.type === "TSNamedTupleMember" ? member.elementType : member;
		return value.type === "TSOptionalType" || value.type === "TSRestType" ? null : value;
	}
	if (object.type !== "TSTypeLiteral") return null;
	const member = object.members.find(
		(candidate) =>
			candidate.type === "TSPropertySignature" &&
			!candidate.computed &&
			(candidate.key.type === "Identifier"
				? candidate.key.name === key
				: candidate.key.type === "Literal" && candidate.key.value === key),
	);
	return member?.type === "TSPropertySignature" && !member.optional
		? (member.typeAnnotation?.typeAnnotation ?? null)
		: null;
}

export function classifyUnsafeDefaults(
	declaration: ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration,
	environment: TypeEnvironment,
	container: "dictionary" | "map",
): UnsafeDictionary | null {
	if (!declaration.typeParameters?.params.some((parameter) => parameter.default != null))
		return null;
	const substitutions = aliasSubstitution(declaration, {}, new Map(), true);
	if (substitutions === null) return null;
	if (declaration.type === "TSTypeAliasDeclaration") {
		if (classifyUnsafeContainer(declaration.typeAnnotation, environment, container) !== null)
			return null;
		return classifyUnsafeContainer(
			declaration.typeAnnotation,
			environment,
			container,
			substitutions,
		);
	}
	for (const heritage of declaration.extends) {
		if (classifyUnsafeContainer(heritage, environment, container) !== null) continue;
		const unsafe = classifyUnsafeContainer(heritage, environment, container, substitutions);
		if (unsafe !== null) return unsafe;
	}
	for (const member of declaration.body.body) {
		if (
			container !== "dictionary" ||
			member.type !== "TSIndexSignature" ||
			member.typeAnnotation === null
		)
			continue;
		const value = member.typeAnnotation.typeAnnotation;
		if (classifyUnsafeDictionaryValue(value, environment) !== null) continue;
		const unsafe = classifyUnsafeDictionaryValue(value, environment, substitutions);
		if (unsafe !== null) return unsafe;
	}
	return null;
}

export function isReportedDefaultReference(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	container: "dictionary" | "map",
): boolean {
	if (type.type !== "TSTypeReference" || type.typeName.type !== "Identifier") return false;
	const supplied = type.typeArguments?.params.length ?? 0;
	const usesReportedDefault = (
		declaration: ESTree.TSTypeAliasDeclaration | ESTree.TSInterfaceDeclaration,
	) =>
		supplied < (declaration.typeParameters?.params.length ?? 0) &&
		classifyUnsafeDefaults(declaration, environment, container) !== null;
	const alias = environment.aliases.get(type.typeName.name);
	if (alias !== undefined && usesReportedDefault(alias)) return true;
	return environment.interfaces.get(type.typeName.name)?.some(usesReportedDefault) ?? false;
}

export function classifyWideningTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
): WideningTarget | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
	if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
	if (unwrapped.type === "TSTypeLiteral") {
		return unwrapped.members.some((member) => member.type === "TSIndexSignature")
			? { kind: "open dictionary" }
			: null;
	}
	if (unwrapped.type === "TSMappedType") return { kind: "open dictionary" };
	if (unwrapped.type !== "TSTypeReference") return null;
	const name = typeReferenceName(unwrapped);
	if (name === null) return null;
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined ? null : classifyWideningTarget(wrapped, environment);
	}
	if (name === "Record" && isBuiltIn(name, environment)) return { kind: "open dictionary" };
	const alias = environment.aliases.get(name);
	if (alias === undefined) return null;
	if ((alias.typeParameters?.params.length ?? 0) > 0) {
		const substitutions = aliasSubstitution(alias, unwrapped, new Map());
		return substitutions !== null &&
			classifyAliasBroadTarget(alias.typeAnnotation, environment, substitutions, new Set([name]))?.kind === "open dictionary"
			? { kind: "generic container" }
			: null;
	}
	const substitutions = aliasSubstitution(alias, unwrapped, new Map());
	if (substitutions === null) return null;
	const resolved = classifyAliasBroadTarget(
		alias.typeAnnotation,
		environment,
		substitutions,
		new Set([name]),
	);
	return resolved;
}

function isBroadMappedKey(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
): boolean {
	const unwrapped = unwrapTransparentType(type);
	if (
		unwrapped.type === "TSStringKeyword" ||
		unwrapped.type === "TSNumberKeyword" ||
		unwrapped.type === "TSSymbolKeyword"
	) {
		return true;
	}
	if (unwrapped.type === "TSUnionType") {
		return unwrapped.types.every((member) => isBroadMappedKey(member, environment, substitutions));
	}
	if (unwrapped.type !== "TSTypeReference") return false;
	const name = typeReferenceName(unwrapped);
	if (name === null) return false;
	const substitution = substitutions.get(name);
	if (substitution !== undefined && !isUnappliedReferenceTo(substitution, name)) {
		return isBroadMappedKey(substitution, environment, substitutions);
	}
	return name === "PropertyKey" && isBuiltIn(name, environment);
}

function classifyAliasBroadTarget(
	type: ESTree.TSType,
	environment: TypeEnvironment,
	substitutions: TypeAliasEnvironment,
	resolvingAliases: ReadonlySet<string>,
): WideningTarget | null {
	const unwrapped = unwrapTransparentType(type);
	if (unwrapped.type === "TSUnknownKeyword") return { kind: "unknown" };
	if (unwrapped.type === "TSObjectKeyword") return { kind: "object" };
	if (unwrapped.type === "TSTypeLiteral") {
		return unwrapped.members.some((member) => member.type === "TSIndexSignature")
			? { kind: "open dictionary" }
			: null;
	}
	if (unwrapped.type === "TSMappedType") {
		return isBroadMappedKey(unwrapped.constraint, environment, substitutions)
			? { kind: "open dictionary" }
			: null;
	}
	if (unwrapped.type !== "TSTypeReference") return null;
	const name = typeReferenceName(unwrapped);
	if (name === null) return null;
	const substitution = substitutions.get(name);
	if (substitution !== undefined) {
		return isUnappliedReferenceTo(substitution, name)
			? null
			: classifyAliasBroadTarget(substitution, environment, substitutions, resolvingAliases);
	}
	if (TRANSPARENT_WRAPPERS.has(name) && isBuiltIn(name, environment)) {
		const wrapped = unwrapped.typeArguments?.params[0];
		return wrapped === undefined
			? null
			: classifyAliasBroadTarget(wrapped, environment, substitutions, resolvingAliases);
	}
	if (name === "Record" && isBuiltIn(name, environment)) {
		return { kind: "open dictionary" };
	}
	const alias = environment.aliases.get(name);
	if (alias === undefined || resolvingAliases.has(name)) return null;
	const nextSubstitutions = aliasSubstitution(alias, unwrapped, substitutions);
	if (nextSubstitutions === null) return null;
	const nextResolving = new Set(resolvingAliases);
	nextResolving.add(name);
	return classifyAliasBroadTarget(
		alias.typeAnnotation,
		environment,
		nextSubstitutions,
		nextResolving,
	);
}

export function isPopulatedObjectExpression(expression: ESTree.Expression): boolean {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current.type === "ObjectExpression" && current.properties.length > 0;
}

export function isKnownEvidenceExpression(expression: ESTree.Expression): boolean {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression" ||
		current.type === "TSSatisfiesExpression"
	) {
		current = current.expression;
	}
	if (current.type === "ObjectExpression") return true;
	return (
		current.type === "ArrayExpression" ||
		current.type === "ArrowFunctionExpression" ||
		current.type === "ClassExpression" ||
		current.type === "FunctionExpression" ||
		current.type === "NewExpression" ||
		current.type === "Literal" ||
		current.type === "TemplateLiteral" ||
		current.type === "UnaryExpression"
	);
}
