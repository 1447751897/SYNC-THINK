import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const shell = join(root, 'apps/desktop/src/renderer/shell');
const output = join(shell, 'design-system/catalog.generated.ts');
// Read actual preview registry keys, so coverage cannot drift from the fixtures.
const fixtureSource = readFileSync(join(shell, 'design-system/fixtures/Showcase.tsx'), 'utf8');
const fixtureAst = ts.createSourceFile(
  'Showcase.tsx',
  fixtureSource,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const liveFiles = new Set();
function visitRegistry(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(fixtureAst) === 'registry' &&
    node.initializer &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    for (const property of node.initializer.properties) {
      if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)))
        liveFiles.add(property.name.text);
    }
  }
  ts.forEachChild(node, visitRegistry);
}
visitRegistry(fixtureAst);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'design-system' ? [] : walk(path);
    return entry.name.endsWith('.tsx') &&
      !/\.test\.|Fixture|DevOverlay|(?:qa|shell|design-system)-entry|DesignSystemPage|LiveSpecimens/.test(
        entry.name,
      )
      ? [path]
      : [];
  });
}
export function generateDesignCatalog() {
  const doc = JSON.parse(
    readFileSync(join(root, 'docs/product/16-shell-design-tokens.json'), 'utf8'),
  );
  const tokens = doc.groups
    .filter((g) => g.id !== 'website')
    .flatMap((g) =>
      Object.entries(g.tokens).map(([key, value]) => ({
        name: g.prefix + key,
        group: g.id,
        light: Array.isArray(value) ? value[0] : value,
        dark: Array.isArray(value) ? value[1] : value,
      })),
    );
  const components = [shell, join(root, 'packages/ui-kit/src/components')]
    .flatMap((dir) => walk(dir))
    .map((path) => {
      const text = readFileSync(path, 'utf8');
      const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const exports = [];
      for (const statement of ast.statements) {
        if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name &&
          /^[A-Z]/.test(statement.name.text)
        )
          exports.push(statement.name.text);
        if (ts.isVariableStatement(statement))
          for (const declaration of statement.declarationList.declarations) {
            if (
              ts.isIdentifier(declaration.name) &&
              /^[A-Z][a-z]/.test(declaration.name.text) &&
              declaration.initializer &&
              (ts.isCallExpression(declaration.initializer) ||
                ts.isArrowFunction(declaration.initializer))
            )
              exports.push(declaration.name.text);
          }
      }
      const name = path.split(/[\\/]/).at(-1).replace('.tsx', '');
      const source = relative(root, path).replaceAll('\\', '/');
      const legacy = source.startsWith('packages/');
      return {
        name,
        source,
        exports,
        category: legacy
          ? '历史 UI Kit'
          : /abilities\//.test(source)
            ? '能力中心'
            : /Chat|Composer|compose|Message|Conversation|Markdown|Citation|Answer|Streaming/.test(
                  name,
                )
              ? '对话与输入'
              : /Approval|Toast|Dialog|Loading|Question|Process|Timeline|Status/.test(name)
                ? '反馈与执行'
                : /File|Code|Diff|Git|Terminal|Preview|Excalidraw|Resource/.test(name)
                  ? '文件与工作台'
                  : /Settings|Provider|Kernel|Model/.test(name)
                    ? '设置与模型'
                    : /Agent|Team|Bot|Avatar/.test(name)
                      ? '智能体与小队'
                      : /Browser/.test(name)
                        ? '浏览器'
                        : '框架与导航',
        live: !legacy && liveFiles.has(name),
        legacy,
      };
    })
    .filter((c) => c.exports.length > 0)
    .sort((a, b) => a.source.localeCompare(b.source));
  // Keep the generated index as compact tuples: repeated field names and full
  // source prefixes otherwise cost tens of KB in the lazy production chunk.
  const tokenRows = tokens.map((t) => [
    t.name,
    t.group,
    t.light,
    ...(t.dark === t.light ? [] : [t.dark]),
  ]);
  const componentRows = components.map((c) => [
    c.source
      .replace('apps/desktop/src/renderer/shell/', '')
      .replace('packages/ui-kit/src/components/', ''),
    c.exports,
    c.category,
    c.live,
    c.legacy,
  ]);
  const content =
    '// Generated by scripts/generate-design-catalog.mjs. Do not edit.\n' +
    'const tokens: [string, string, string, string?][] = ' +
    JSON.stringify(tokenRows) +
    ';\n' +
    'export const TOKEN_CATALOG = tokens.map(([name, group, light, dark]) => ({ name, group, light, dark: dark ?? light }));\n' +
    'const components: [string, string[], string, boolean, boolean][] = ' +
    JSON.stringify(componentRows) +
    ';\n' +
    'export const COMPONENT_CATALOG = components.map(([path, exports, category, live, legacy]) => ({name: path.split("/").at(-1)!.replace(".tsx", ""), source: (legacy ? "packages/ui-kit/src/components/" : "apps/desktop/src/renderer/shell/") + path, exports, category, live, legacy}));\n';
  if (process.argv.includes('--check')) {
    if (readFileSync(output, 'utf8') !== content)
      throw new Error('Design catalog is stale. Run pnpm design:catalog.');
  } else writeFileSync(output, content);
  console.log(
    `Design catalog: ${tokens.length} desktop tokens; ${components.length} component source files (${components.filter((c) => c.live).length} live fixtures).`,
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  generateDesignCatalog();
