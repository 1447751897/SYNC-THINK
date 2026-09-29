import { EditorView } from '@codemirror/view';
import { redo, selectAll, undo } from '@codemirror/commands';
export { redoDepth, undoDepth } from '@codemirror/commands';
export const findView = (target: HTMLElement) => EditorView.findFromDOM(target);
export const isEditable = (view: EditorView) => view.state.facet(EditorView.editable);
export const execute = (view: EditorView, command: 'undo' | 'redo' | 'selectAll') => ({ undo, redo, selectAll })[command](view);
