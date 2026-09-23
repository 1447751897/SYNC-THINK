import path from 'node:path';
import ts from 'typescript';

const sourceExtensions = ['.ts', '.tsx', '.mts', '.cts'];
const emittedToSourceExtensions = new Map([
  ['.js', sourceExtensions],
  ['.jsx', ['.tsx', '.ts']],
  ['.mjs', ['.mts', '.ts']],
  ['.cjs', ['.cts', '.ts']],
]);

export function collectModuleSpecifiers(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const specifiers = new Set();
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      specifiers.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...specifiers];
}

function sourceCandidates(target) {
  const extension = path.posix.extname(target);
  const candidates = [];
  if (emittedToSourceExtensions.has(extension)) {
    const stem = target.slice(0, -extension.length);
    for (const sourceExtension of emittedToSourceExtensions.get(extension)) {
      candidates.push(`${stem}${sourceExtension}`);
    }
  } else if (sourceExtensions.includes(extension)) {
    candidates.push(target);
  } else if (!extension) {
    for (const sourceExtension of sourceExtensions) candidates.push(`${target}${sourceExtension}`);
    for (const sourceExtension of sourceExtensions) {
      candidates.push(path.posix.join(target, `index${sourceExtension}`));
    }
  }
  return candidates;
}

function resolveDependency(importer, specifier, files, aliases) {
  const aliased = aliases.get(specifier);
  if (aliased && files.has(aliased)) return aliased;
  if (!specifier.startsWith('.')) return undefined;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
  return sourceCandidates(target).find((candidate) => files.has(candidate));
}

export function buildSourceDependencyGraph(sources, aliases = new Map()) {
  const files = new Set(sources.keys());
  const graph = new Map();
  for (const [file, text] of sources) {
    const dependencies = new Set();
    for (const specifier of collectModuleSpecifiers(file, text)) {
      const dependency = resolveDependency(file, specifier, files, aliases);
      if (dependency) dependencies.add(dependency);
    }
    graph.set(file, dependencies);
  }
  return graph;
}

function representativeCycle(component, graph) {
  const members = new Set(component);
  const start = [...component].sort()[0];
  const path = [start];
  const visiting = new Set([start]);
  const walk = (node) => {
    const dependencies = [...(graph.get(node) ?? [])]
      .filter((dependency) => members.has(dependency))
      .sort();
    for (const dependency of dependencies) {
      if (dependency === start) return [...path, start];
      if (visiting.has(dependency)) continue;
      visiting.add(dependency);
      path.push(dependency);
      const cycle = walk(dependency);
      if (cycle) return cycle;
      path.pop();
      visiting.delete(dependency);
    }
    return undefined;
  };
  return walk(start) ?? [...component.sort(), start];
}

export function findSourceDependencyCycles(graph) {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  const connect = (node) => {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) ?? []) {
      if (!indexes.has(dependency)) {
        connect(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(dependency)));
      }
    }

    if (lowLinks.get(node) !== indexes.get(node)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      component.push(member);
    } while (member !== node);
    if (
      component.length > 1 ||
      (component.length === 1 && graph.get(component[0])?.has(component[0]))
    ) {
      components.push(component);
    }
  };

  for (const node of [...graph.keys()].sort()) {
    if (!indexes.has(node)) connect(node);
  }
  return components
    .map((component) => representativeCycle(component, graph))
    .sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}

export function checkSourceDependencyCycles(sources, aliases = new Map()) {
  return findSourceDependencyCycles(buildSourceDependencyGraph(sources, aliases)).map(
    (cycle) => `Circular source dependency: ${cycle.join(' -> ')}`,
  );
}
