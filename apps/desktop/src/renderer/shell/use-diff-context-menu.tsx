import { useContext, type MouseEvent } from 'react';
import { Copy, FileCode2, FolderOpen } from 'lucide-react';
import { useContextMenu, MessageContextActions, selectionContextActions, selectedContextText, copyContextText } from './ContextMenu.js';

export function useDiffContextMenu() {
  const open = useContextMenu();
  const actions = useContext(MessageContextActions);
  return (event: MouseEvent<HTMLElement>, data: { path?: string; patch?: string; newText?: string }) => {
    const selection = selectedContextText(event.currentTarget);
    open(event, [
      ...selectionContextActions(selection, actions.quote),
      { id: 'diff', label: '复制 Diff', icon: <Copy size={14} />, disabled: data.patch === undefined, separator: !!selection, run: () => copyContextText(data.patch ?? '') },
      ...(data.newText !== undefined ? [{ id: 'after', label: '复制修改后内容', icon: <Copy size={14} />, run: () => copyContextText(data.newText!) }] : []),
      ...(data.path ? [
        { id: 'path', label: '复制文件路径', icon: <FileCode2 size={14} />, separator: true, run: () => copyContextText(data.path!) },
        ...(actions.openFile ? [{ id: 'open', label: '打开对应文件', icon: <FolderOpen size={14} />, run: () => actions.openFile?.(data.path!) }] : []),
      ] : []),
    ]);
  };
}
