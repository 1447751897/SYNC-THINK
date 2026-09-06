import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import c from 'highlight.js/lib/languages/c';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import dos from 'highlight.js/lib/languages/dos';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import protobuf from 'highlight.js/lib/languages/protobuf';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import swift from 'highlight.js/lib/languages/swift';

let hljsReady = false;
function ensureHljs(): void {
  if (hljsReady) return;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('html', xml);
  hljs.registerLanguage('css', css);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('shell', bash);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('c', c);
  hljs.registerLanguage('cmake', cmake);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('dart', dart);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('dos', dos);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('graphql', graphql);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('kotlin', kotlin);
  hljs.registerLanguage('less', less);
  hljs.registerLanguage('lua', lua);
  hljs.registerLanguage('makefile', makefile);
  hljs.registerLanguage('php', php);
  hljs.registerLanguage('powershell', powershell);
  hljs.registerLanguage('protobuf', protobuf);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('scss', scss);
  hljs.registerLanguage('swift', swift);
  hljsReady = true;
}

const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'cmakelists.txt': 'cmake',
  '.bashrc': 'bash',
  '.zshrc': 'bash',
};

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  svg: 'html',
  vue: 'html',
  svelte: 'html',
  xml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  pyw: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  psd1: 'powershell',
  bat: 'dos',
  cmd: 'dos',
  ini: 'ini',
  toml: 'ini',
  conf: 'ini',
  config: 'ini',
  properties: 'ini',
  sql: 'sql',
  rs: 'rust',
  graphql: 'graphql',
  gql: 'graphql',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  lua: 'lua',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
  mk: 'makefile',
  cmake: 'cmake',
  proto: 'protobuf',
};

export function languageFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const base = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base.startsWith('.env')) return 'ini';
  const namedLanguage = LANGUAGE_BY_FILENAME[base];
  if (namedLanguage) return namedLanguage;
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  return LANGUAGE_BY_EXTENSION[ext];
}

export function highlightCode(text: string, language?: string): string | undefined {
  if (!language || text.length > 100_000) return undefined;
  ensureHljs();
  language = language.toLowerCase();
  const normalizedLanguage =
    language === 'tsx' ? 'typescript' : language === 'jsx' ? 'javascript' : language;
  if (!hljs.getLanguage(normalizedLanguage)) return undefined;
  try {
    return hljs.highlight(text, { language: normalizedLanguage, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

export function highlightCodeLines(text: string, language?: string): string[] | undefined {
  const html = highlightCode(text, language);
  if (html === undefined) return undefined;
  try {
    const lines: string[] = [];
    const spans: string[] = [];
    let current = '';
    for (const fragment of html.split(/(\n|<span\b[^>]*>|<\/span>)/)) {
      if (fragment === '\n') {
        lines.push(current + '</span>'.repeat(spans.length));
        current = spans.join('');
        continue;
      }
      if (fragment.startsWith('<span')) spans.push(fragment);
      else if (fragment === '</span>') spans.pop();
      current += fragment;
    }
    lines.push(current);
    return lines;
  } catch {
    return undefined;
  }
}
