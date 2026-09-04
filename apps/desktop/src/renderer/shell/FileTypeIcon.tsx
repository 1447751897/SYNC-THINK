import {
  Braces,
  CodeXml,
  Container,
  Database,
  FileArchive,
  FileCog,
  FileImage,
  FileJson2,
  FileLock2,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Package,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import clsx from 'clsx';

type FileIconKind =
  | 'archive'
  | 'config'
  | 'css'
  | 'database'
  | 'docker'
  | 'git'
  | 'image'
  | 'javascript'
  | 'json'
  | 'lock'
  | 'markdown'
  | 'package'
  | 'python'
  | 'shell'
  | 'spreadsheet'
  | 'text'
  | 'typescript'
  | 'xml';

interface FileIconSpec {
  kind: FileIconKind;
  label?: string;
  icon?: LucideIcon;
}

const extensionPattern = /\.([^.\\/]+)$/;

function fileIconSpec(path: string): FileIconSpec {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const extension = extensionPattern.exec(name)?.[1] ?? '';

  if (name === 'dockerfile' || name.startsWith('dockerfile.')) {
    return { kind: 'docker', icon: Container };
  }
  if (
    name === '.gitignore' ||
    name === '.gitattributes' ||
    name === '.gitmodules' ||
    name === '.gitkeep'
  ) {
    return { kind: 'git', icon: GitBranch };
  }
  if (
    name === 'package.json' ||
    name === 'package-lock.json' ||
    name === 'pnpm-lock.yaml' ||
    name === 'yarn.lock'
  ) {
    return {
      kind: name === 'package.json' ? 'package' : 'lock',
      icon: name === 'package.json' ? Package : FileLock2,
    };
  }
  if (name === 'makefile' || name === 'cmakelists.txt') {
    return { kind: 'config', icon: FileCog };
  }

  switch (extension) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return { kind: 'javascript', label: 'JS' };
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return { kind: 'typescript', label: 'TS' };
    case 'py':
    case 'pyw':
      return { kind: 'python', label: 'PY' };
    case 'json':
    case 'jsonc':
      return { kind: 'json', icon: FileJson2 };
    case 'md':
    case 'mdx':
      return { kind: 'markdown', icon: FileText };
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
    case 'vue':
    case 'svelte':
      return { kind: 'xml', icon: CodeXml };
    case 'css':
    case 'scss':
    case 'sass':
    case 'less':
      return { kind: 'css', label: 'CSS' };
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'fish':
      return { kind: 'shell', icon: SquareTerminal };
    case 'ps1':
    case 'psm1':
    case 'bat':
    case 'cmd':
      return { kind: 'shell', icon: SquareTerminal };
    case 'yaml':
    case 'yml':
    case 'toml':
    case 'ini':
    case 'conf':
    case 'config':
    case 'env':
      return { kind: 'config', icon: FileCog };
    case 'sql':
    case 'db':
    case 'sqlite':
    case 'sqlite3':
      return { kind: 'database', icon: Database };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'avif':
    case 'ico':
    case 'bmp':
      return { kind: 'image', icon: FileImage };
    case 'csv':
    case 'tsv':
    case 'xls':
    case 'xlsx':
      return { kind: 'spreadsheet', icon: FileSpreadsheet };
    case 'zip':
    case '7z':
    case 'rar':
    case 'tar':
    case 'gz':
    case 'tgz':
      return { kind: 'archive', icon: FileArchive };
    case 'lock':
      return { kind: 'lock', icon: FileLock2 };
    case 'txt':
    case 'log':
      return { kind: 'text', icon: FileText };
    default:
      return { kind: 'text', icon: extension ? Braces : FileText };
  }
}

export function FileTypeIcon({
  path,
  size = 14,
  className,
}: {
  path: string;
  size?: number;
  className?: string;
}) {
  const spec = fileIconSpec(path);
  const Icon = spec.icon;

  return (
    <span
      className={clsx('shell-file-type-icon', spec.label && 'is-badge', className)}
      data-file-type={spec.kind}
      aria-hidden="true"
      style={{ width: size, height: size }}
    >
      {Icon ? <Icon size={size} strokeWidth={1.7} /> : <span>{spec.label}</span>}
    </span>
  );
}
