import { StateEffect, StateField, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import type { ComposeAttachment } from './compose-mention.js';
import type { ComposerEditorPastedReference, ComposerEditorSkill } from './ComposerEditor.js';

export type ComposerEditorInlineTokenKind = 'skill' | 'file' | 'folder' | 'pasted';

export interface ComposerEditorInlineToken {
  kind: ComposerEditorInlineTokenKind;
  label: string;
  value: string;
  start: number;
  end: number;
}

export interface ComposerEditorTokenCallbacks {
  onRemoveSkill?: (skillVersionId: string) => void;
  onOpenAttachment?: (attachment: ComposeAttachment) => void;
  onRemoveAttachment?: (path: string) => void;
  onOpenPastedReference?: (reference: ComposerEditorPastedReference) => void;
  onRemovePastedReference?: (id: string) => void;
}

export interface ComposerEditorTokenCallbacksRef {
  current: ComposerEditorTokenCallbacks;
}

export interface ComposerEditorTokenConfig {
  selectedSkills: readonly ComposerEditorSkill[];
  attachments: readonly ComposeAttachment[];
  pastedReferences: readonly ComposerEditorPastedReference[];
  callbacksRef: ComposerEditorTokenCallbacksRef;
  disabled: boolean;
}

const INLINE_TOKEN_PATTERN =
  /\[([^\]\n]+)\]\((newmax-skill|newmax-file|newmax-folder|newmax-pasted|newmax-pasted-text):([^)]+)\)/g;

function decodeTokenValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseComposerEditorInlineTokens(value: string): ComposerEditorInlineToken[] {
  const tokens: ComposerEditorInlineToken[] = [];
  for (const match of value.matchAll(INLINE_TOKEN_PATTERN)) {
    if (match.index === undefined) continue;
    const scheme = match[2];
    const decodedValue = decodeTokenValue(match[3] ?? '');
    if (!scheme || decodedValue === null) continue;
    const kind: ComposerEditorInlineTokenKind =
      scheme === 'newmax-skill'
        ? 'skill'
        : scheme === 'newmax-file'
          ? 'file'
          : scheme === 'newmax-folder'
            ? 'folder'
            : 'pasted';
    tokens.push({
      kind,
      label: match[1] ?? decodedValue,
      value: decodedValue,
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

class ComposerEditorTokenWidget extends WidgetType {
  constructor(
    readonly token: ComposerEditorInlineToken,
    readonly config: ComposerEditorTokenConfig,
  ) {
    super();
  }

  eq(other: ComposerEditorTokenWidget): boolean {
    return (
      other.token.kind === this.token.kind &&
      other.token.label === this.token.label &&
      other.token.value === this.token.value &&
      other.config.disabled === this.config.disabled &&
      other.config.selectedSkills === this.config.selectedSkills &&
      other.config.attachments === this.config.attachments &&
      other.config.pastedReferences === this.config.pastedReferences
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = [
      'shell-composer-editor__atomic-token',
      `shell-composer-editor__atomic-token--${this.token.kind}`,
    ].join(' ');
    element.disabled = this.config.disabled;
    element.tabIndex = -1;
    element.textContent = this.token.label;
    element.style.userSelect = 'none';
    element.style.webkitUserSelect = 'none';
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    const callbacks = this.config.callbacksRef.current;
    if (this.token.kind === 'skill') {
      const skill = this.config.selectedSkills.find((item) => item.name === this.token.value);
      element.setAttribute(
        'aria-label',
        skill && callbacks.onRemoveSkill
          ? `移除 Skill ${skill.name}`
          : `已选择 Skill ${this.token.label}`,
      );
      if (skill && callbacks.onRemoveSkill) {
        element.addEventListener('click', () => callbacks.onRemoveSkill?.(skill.skillVersionId));
      }
    } else if (this.token.kind === 'pasted') {
      const reference = this.config.pastedReferences.find((item) => item.id === this.token.value);
      element.setAttribute('aria-label', `打开粘贴引用 ${this.token.label}`);
      if (reference && callbacks.onOpenPastedReference) {
        element.addEventListener('click', () => callbacks.onOpenPastedReference?.(reference));
      }
    } else {
      const attachment = this.config.attachments.find((item) => item.path === this.token.value);
      element.setAttribute('aria-label', `打开附件 ${this.token.label}`);
      if (attachment && callbacks.onOpenAttachment) {
        element.addEventListener('click', () => callbacks.onOpenAttachment?.(attachment));
      }
    }
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(documentValue: string, config: ComposerEditorTokenConfig): DecorationSet {
  return Decoration.set(
    parseComposerEditorInlineTokens(documentValue).map((token) =>
      Decoration.replace({
        widget: new ComposerEditorTokenWidget(token, config),
        inclusive: false,
      }).range(token.start, token.end),
    ),
    true,
  );
}

interface ComposerEditorTokenFieldValue {
  config: ComposerEditorTokenConfig | null;
  decorations: DecorationSet;
}

export const setComposerEditorTokenConfig = StateEffect.define<ComposerEditorTokenConfig>();

const composerEditorTokenField = StateField.define<ComposerEditorTokenFieldValue>({
  create: () => ({ config: null, decorations: Decoration.none }),
  update(current, transaction) {
    let config = current.config;
    let shouldRebuild = transaction.docChanged;
    for (const effect of transaction.effects) {
      if (!effect.is(setComposerEditorTokenConfig)) continue;
      config = effect.value;
      shouldRebuild = true;
    }
    return {
      config,
      decorations:
        config && shouldRebuild
          ? buildDecorations(transaction.state.doc.toString(), config)
          : current.decorations.map(transaction.changes),
    };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => () => value.decorations),
  ],
});

export const composerEditorTokenExtension: Extension = composerEditorTokenField;

function removeTokenSideEffect(
  token: ComposerEditorInlineToken,
  config: ComposerEditorTokenConfig | null,
): void {
  if (!config) return;
  const callbacks = config.callbacksRef.current;
  if (token.kind === 'skill') {
    const skill = config.selectedSkills.find((item) => item.name === token.value);
    if (skill) callbacks.onRemoveSkill?.(skill.skillVersionId);
    return;
  }
  if (token.kind === 'pasted') {
    callbacks.onRemovePastedReference?.(token.value);
    return;
  }
  callbacks.onRemoveAttachment?.(token.value);
}

export function deleteComposerEditorInlineToken(
  view: EditorView,
  direction: 'backward' | 'forward',
): boolean {
  const selection = view.state.selection.main;
  if (!selection.empty) return false;
  const documentValue = view.state.doc.toString();
  const cursor = selection.head;
  const token = parseComposerEditorInlineTokens(documentValue).find((candidate) => {
    if (direction === 'forward') return cursor === candidate.start;
    return (
      cursor === candidate.end ||
      (documentValue[candidate.end] === ' ' && cursor === candidate.end + 1)
    );
  });
  if (!token) return false;

  const deleteTo = token.end + (documentValue[token.end] === ' ' ? 1 : 0);
  removeTokenSideEffect(token, view.state.field(composerEditorTokenField, false)?.config ?? null);
  view.dispatch({
    changes: { from: token.start, to: deleteTo },
    selection: { anchor: token.start },
    scrollIntoView: true,
  });
  return true;
}
