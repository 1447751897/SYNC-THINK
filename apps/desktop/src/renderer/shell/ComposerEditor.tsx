import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEventHandler,
  type CSSProperties,
  type DragEventHandler,
  type KeyboardEventHandler,
  type MutableRefObject,
  type Ref,
  type ReactNode,
} from 'react';
import { Annotation, Compartment, EditorState, Prec, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  placeholder as codeMirrorPlaceholder,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { File, FileText, Folder, Puzzle, X } from 'lucide-react';
import type { SkillVersionSummary } from '@sync-think/protocol';
import type { ComposeAttachment } from './compose-mention.js';
import {
  composerEditorTokenExtension,
  deleteComposerEditorInlineToken,
  parseComposerEditorInlineTokens,
  setComposerEditorTokenConfig,
  type ComposerEditorTokenCallbacks,
} from './ComposerEditorTokens.js';

export interface ComposerEditorSelection {
  start: number;
  end: number;
}

export type ComposerEditorSkill = Pick<
  SkillVersionSummary,
  'skillVersionId' | 'name' | 'version' | 'description'
>;

/** View data for an existing pasted-text attachment/reference. */
export interface ComposerEditorPastedReference {
  id: string;
  label: string;
  preview?: string;
}

export interface ComposerEditorHandle {
  focus: (options?: FocusOptions) => void;
  blur: () => void;
  getSelection: () => ComposerEditorSelection;
  setSelectionRange: (
    start: number,
    end: number,
    direction?: 'forward' | 'backward' | 'none',
  ) => void;
  containsEventTarget: (target: EventTarget | null) => boolean;
  getInputElement: () => HTMLTextAreaElement | null;
  getRootElement: () => HTMLDivElement | null;
}

export interface ComposerEditorProps {
  value: string;
  onChange: (value: string, selection: ComposerEditorSelection) => void;
  onSubmit?: (value: string, selection: ComposerEditorSelection) => void;
  onSelectionChange?: (selection: ComposerEditorSelection) => void;
  onFocusChange?: (focused: boolean) => void;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  onPaste?: ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  disabled?: boolean;
  goalRunning?: boolean;
  placeholder?: string;
  goalRunningPlaceholder?: string;
  minHeight?: number;
  maxHeight?: number;
  chatFontSize?: number;
  serifFontFamily?: string;
  selectedSkills?: readonly ComposerEditorSkill[];
  attachments?: readonly ComposeAttachment[];
  pastedReferences?: readonly ComposerEditorPastedReference[];
  onRemoveSkill?: (skillVersionId: string) => void;
  onOpenAttachment?: (attachment: ComposeAttachment) => void;
  onRemoveAttachment?: (path: string) => void;
  onOpenPastedReference?: (reference: ComposerEditorPastedReference) => void;
  onRemovePastedReference?: (id: string) => void;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  inputId?: string;
  inputName?: string;
  inputElementRef?: Ref<HTMLTextAreaElement>;
  inputTestId?: string;
  testId?: string;
  className?: string;
  inputClassName?: string;
  style?: CSSProperties;
  inputStyle?: CSSProperties;
  /** Inline action rendered after the last draft character. */
  trailingAction?: ReactNode;
  /** Blur the draft and lock editing while an inline action is in progress. */
  enhancing?: boolean;
  autoFocus?: boolean;
  spellCheck?: boolean;
}

const DEFAULT_MIN_HEIGHT = 36;
const DEFAULT_MAX_HEIGHT = 200;
const DEFAULT_FONT_SIZE = 15;
const COMPOSER_EDITOR_VERTICAL_PADDING = 20;
const COMPOSER_EDITOR_LINE_HEIGHT_RATIO = 1.45;
const externalValueSyncAnnotation = Annotation.define<boolean>();

interface ComposerEditorCallbacks {
  onChange: ComposerEditorProps['onChange'];
  onSubmit: ComposerEditorProps['onSubmit'];
  onSelectionChange: ComposerEditorProps['onSelectionChange'];
  onFocusChange: ComposerEditorProps['onFocusChange'];
  onKeyDown: ComposerEditorProps['onKeyDown'];
  onPaste: ComposerEditorProps['onPaste'];
}

function readTextareaSelection(
  input: HTMLTextAreaElement,
  fallbackLength = input.value.length,
): ComposerEditorSelection {
  return {
    start: input.selectionStart ?? fallbackLength,
    end: input.selectionEnd ?? fallbackLength,
  };
}

function readEditorSelection(view: EditorView): ComposerEditorSelection {
  const range = view.state.selection.main;
  return { start: range.from, end: range.to };
}

function clampSelectionOffset(value: number, documentLength: number): number {
  return Math.max(0, Math.min(value, documentLength));
}

function assignRef<T>(target: Ref<T> | undefined, value: T | null): void {
  if (typeof target === 'function') {
    target(value);
  } else if (target) {
    (target as MutableRefObject<T | null>).current = value;
  }
}

function createReactEventProxy<TNative extends Event, TReact>(
  event: TNative,
  currentTarget: HTMLTextAreaElement | null,
): TReact {
  return new Proxy(event, {
    get(target, property) {
      if (property === 'nativeEvent') return target;
      if (property === 'currentTarget' || property === 'target') return currentTarget;
      if (property === 'isDefaultPrevented') return () => target.defaultPrevented;
      if (property === 'isPropagationStopped') return () => false;
      if (property === 'persist') return () => undefined;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as unknown as TReact;
}

function emptyDomRect(): DOMRect {
  if (typeof DOMRect !== 'undefined') return new DOMRect(0, 0, 0, 0);
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
  };
}

function ensureCodeMirrorMeasurementApis(): void {
  if (typeof Range === 'undefined') return;
  if (typeof Range.prototype.getClientRects !== 'function') {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      configurable: true,
      value: () => [] as unknown as DOMRectList,
    });
  }
  if (typeof Range.prototype.getBoundingClientRect !== 'function') {
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: emptyDomRect,
    });
  }
}

function composerEditorTheme(options: {
  minHeight: number;
  maxHeight: number;
  fontSize: number;
  fontFamily?: string;
}) {
  const lineHeight = Math.ceil(options.fontSize * COMPOSER_EDITOR_LINE_HEIGHT_RATIO);
  const minBoxHeight = options.minHeight + COMPOSER_EDITOR_VERTICAL_PADDING;
  return EditorView.theme({
    '&': {
      minHeight: `${minBoxHeight}px`,
      maxHeight: `${options.maxHeight}px`,
      backgroundColor: 'transparent',
    },
    '.cm-scroller': {
      minHeight: `${minBoxHeight}px`,
      maxHeight: `${options.maxHeight}px`,
      overflow: 'auto',
      fontFamily: options.fontFamily ?? 'inherit',
    },
    '.cm-content': {
      minHeight: `${options.minHeight}px`,
      padding: '12px 12px 8px 16px',
      fontFamily: options.fontFamily ?? 'inherit',
      fontSize: `${options.fontSize}px`,
      lineHeight: `${lineHeight}px`,
      letterSpacing: '0',
      color: 'var(--composer-text)',
      caretColor: 'var(--composer-text)',
    },
    '.cm-line': {
      minHeight: `${lineHeight}px`,
      padding: '0',
      lineHeight: `${lineHeight}px`,
    },
    '.cm-placeholder': {
      color: 'var(--composer-text-faint)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--composer-text)',
    },
    '.cm-selectionBackground': {
      backgroundColor: 'var(--color-selection, var(--composer-hover)) !important',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  });
}

class ComposerTrailingActionSlotWidget extends WidgetType {
  toDOM() {
    const slot = document.createElement('span');
    slot.className = 'shell-composer-editor__trailing-action-slot';
    slot.setAttribute('contenteditable', 'false');
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }

  eq() {
    return true;
  }

  ignoreEvent() {
    return true;
  }
}

function trailingActionDecorations(docLength: number): DecorationSet {
  return Decoration.set([
    Decoration.widget({
      widget: new ComposerTrailingActionSlotWidget(),
      side: 1,
    }).range(docLength),
  ]);
}

const trailingActionDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return trailingActionDecorations(state.doc.length);
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return trailingActionDecorations(transaction.state.doc.length);
    }
    return decorations.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(
    {
      value,
      onChange,
      onSubmit,
      onSelectionChange,
      onFocusChange,
      onKeyDown,
      onPaste,
      onDrop,
      onDragOver,
      disabled = false,
      goalRunning = false,
      placeholder = '',
      goalRunningPlaceholder = '暂停目标后输入',
      minHeight = DEFAULT_MIN_HEIGHT,
      maxHeight = DEFAULT_MAX_HEIGHT,
      chatFontSize = DEFAULT_FONT_SIZE,
      serifFontFamily,
      selectedSkills = [],
      attachments = [],
      pastedReferences = [],
      onRemoveSkill,
      onOpenAttachment,
      onRemoveAttachment,
      onOpenPastedReference,
      onRemovePastedReference,
      ariaLabel = '消息',
      ariaDescribedBy,
      inputId,
      inputName,
      inputElementRef,
      inputTestId,
      testId = 'composer-editor',
      className = '',
      inputClassName = '',
      style,
      inputStyle,
      trailingAction,
      enhancing = false,
      autoFocus = false,
      spellCheck = true,
    },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const editorHostRef = useRef<HTMLDivElement>(null);
    const trailingActionRef = useRef<HTMLDivElement>(null);
    const trailingActionCompartmentRef = useRef(new Compartment());
    const hasTrailingAction = Boolean(trailingAction);
    const viewRef = useRef<EditorView | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const compatibilityPendingValueRef = useRef<string | null>(null);
    const nativeSetSelectionRangeRef = useRef<
      ((start: number, end: number, direction?: 'forward' | 'backward' | 'none') => void) | null
    >(null);
    const compositionRef = useRef(false);
    const placeholderCompartmentRef = useRef(new Compartment());
    const readOnlyCompartmentRef = useRef(new Compartment());
    const editableCompartmentRef = useRef(new Compartment());
    const themeCompartmentRef = useRef(new Compartment());
    const attributesCompartmentRef = useRef(new Compartment());
    const effectiveDisabled = disabled || goalRunning;
    const enhancingLocked = effectiveDisabled || enhancing;
    const effectivePlaceholder = goalRunning ? goalRunningPlaceholder : placeholder;
    const safeMinHeight = Math.max(0, Math.min(minHeight, maxHeight));
    const safeMaxHeight = Math.max(safeMinHeight, maxHeight);
    const callbacksRef = useRef<ComposerEditorCallbacks>({
      onChange,
      onSubmit,
      onSelectionChange,
      onFocusChange,
      onKeyDown,
      onPaste,
    });
    callbacksRef.current = {
      onChange,
      onSubmit,
      onSelectionChange,
      onFocusChange,
      onKeyDown,
      onPaste,
    };
    const tokenCallbacksRef = useRef<ComposerEditorTokenCallbacks>({
      onRemoveSkill,
      onOpenAttachment,
      onRemoveAttachment,
      onOpenPastedReference,
      onRemovePastedReference,
    });
    tokenCallbacksRef.current = {
      onRemoveSkill,
      onOpenAttachment,
      onRemoveAttachment,
      onOpenPastedReference,
      onRemovePastedReference,
    };

    const syncCompatibilityInput = useCallback(
      (nextValue: string, selection: ComposerEditorSelection) => {
        const input = inputRef.current;
        if (!input) return;
        input.value = nextValue;
        nativeSetSelectionRangeRef.current?.(selection.start, selection.end, 'none');
      },
      [],
    );

    // Keep the hidden compatibility bridge and the visible CodeMirror surface
    // on the same NewMax auto-grow geometry. Existing callers still inspect the
    // textarea style, while users interact with the CodeMirror content DOM.
    const syncEditorHeight = useCallback(() => {
      const input = inputRef.current;
      const host = editorHostRef.current;
      const content = host?.querySelector<HTMLElement>('.cm-content');
      // Collapse the last explicit height first. Otherwise scrollHeight stays at
      // the previous grown size after send/delete and the box never shrinks.
      if (input) input.style.height = 'auto';
      if (host) host.style.height = 'auto';
      const measured = Math.max(
        input?.scrollHeight ?? 0,
        content?.scrollHeight ?? 0,
        host?.scrollHeight ?? 0,
      );
      const nextHeight = Math.min(
        safeMaxHeight,
        Math.max(safeMinHeight, measured || safeMinHeight),
      );
      if (input) input.style.height = `${nextHeight}px`;
      if (host) host.style.height = `${nextHeight}px`;
    }, [safeMaxHeight, safeMinHeight]);

    const syncTrailingActionPosition = useCallback(() => {
      const root = rootRef.current;
      const action = trailingActionRef.current;
      const slot = root?.querySelector<HTMLElement>(
        '.shell-composer-editor__trailing-action-slot',
      );
      if (!root || !action || !slot) return;
      const rootRect = root.getBoundingClientRect();
      const slotRect = slot.getBoundingClientRect();
      action.style.left = `${Math.max(0, slotRect.left - rootRect.left)}px`;
      action.style.top = `${Math.max(0, slotRect.top - rootRect.top)}px`;
    }, []);

    const syncEditorFromCompatibilityInput = useCallback(
      (nextValue: string, selection: ComposerEditorSelection) => {
        const view = viewRef.current;
        if (!view) {
          syncCompatibilityInput(nextValue, selection);
          return;
        }
        const currentValue = view.state.doc.toString();
        const start = clampSelectionOffset(selection.start, nextValue.length);
        const end = clampSelectionOffset(selection.end, nextValue.length);
        view.dispatch({
          ...(currentValue === nextValue
            ? {}
            : { changes: { from: 0, to: currentValue.length, insert: nextValue } }),
          selection: { anchor: start, head: end },
          scrollIntoView: true,
          annotations: externalValueSyncAnnotation.of(true),
        });
        syncCompatibilityInput(nextValue, { start, end });
      },
      [syncCompatibilityInput],
    );

    const setEditorSelection = useCallback(
      (
        start: number,
        end: number,
        direction: 'forward' | 'backward' | 'none' = 'none',
        focus = true,
      ) => {
        const view = viewRef.current;
        if (!view) return;
        const documentLength = view.state.doc.length;
        const nextStart = clampSelectionOffset(start, documentLength);
        const nextEnd = clampSelectionOffset(end, documentLength);
        const anchor = direction === 'backward' ? nextEnd : nextStart;
        const head = direction === 'backward' ? nextStart : nextEnd;
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
        if (focus) view.focus();
        nativeSetSelectionRangeRef.current?.(nextStart, nextEnd, direction);
        callbacksRef.current.onSelectionChange?.({ start: nextStart, end: nextEnd });
      },
      [],
    );

    const setInputRef = useCallback(
      (input: HTMLTextAreaElement | null) => {
        inputRef.current = input;
        nativeSetSelectionRangeRef.current = input
          ? HTMLTextAreaElement.prototype.setSelectionRange.bind(input)
          : null;
        if (input) {
          input.focus = () => viewRef.current?.focus();
          input.blur = () => viewRef.current?.contentDOM.blur();
          input.setSelectionRange = (start, end, direction = 'none') => {
            const normalizedStart = start ?? 0;
            setEditorSelection(
              normalizedStart,
              end ?? normalizedStart,
              direction ?? 'none',
              true,
            );
          };
        }
        assignRef(inputElementRef, input);
      },
      [inputElementRef, setEditorSelection],
    );

    const baseExtensions = useMemo(
      () => [
        history(),
        Prec.highest(
          keymap.of([
            {
              key: 'Backspace',
              run: (view) => deleteComposerEditorInlineToken(view, 'backward'),
            },
            {
              key: 'Delete',
              run: (view) => deleteComposerEditorInlineToken(view, 'forward'),
            },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        composerEditorTokenExtension,
        EditorView.updateListener.of((update) => {
      const selection = readEditorSelection(update.view);
      syncCompatibilityInput(update.state.doc.toString(), selection);
      syncEditorHeight();
      syncTrailingActionPosition();
          const isExternalValueSync = update.transactions.some((transaction) =>
            transaction.annotation(externalValueSyncAnnotation),
          );
          if (update.docChanged && !isExternalValueSync) {
            callbacksRef.current.onChange(update.state.doc.toString(), selection);
          }
          if (update.selectionSet || update.focusChanged || update.docChanged) {
            callbacksRef.current.onSelectionChange?.(selection);
          }
        }),
      ],
      [syncCompatibilityInput, syncEditorHeight, syncTrailingActionPosition],
    );

    useLayoutEffect(() => {
      const host = editorHostRef.current;
      if (!host) return;
      ensureCodeMirrorMeasurementApis();
      const state = EditorState.create({
        doc: value,
        extensions: [
          ...baseExtensions,
          placeholderCompartmentRef.current.of(codeMirrorPlaceholder(effectivePlaceholder)),
          readOnlyCompartmentRef.current.of(EditorState.readOnly.of(enhancingLocked)),
          editableCompartmentRef.current.of(EditorView.editable.of(!enhancingLocked)),
          themeCompartmentRef.current.of(
            composerEditorTheme({
              minHeight: safeMinHeight,
              maxHeight: safeMaxHeight,
              fontSize: chatFontSize,
              fontFamily: serifFontFamily,
            }),
          ),
          attributesCompartmentRef.current.of(
            EditorView.contentAttributes.of({
              'aria-label': ariaLabel,
              ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
              'aria-disabled': enhancingLocked ? 'true' : 'false',
              spellcheck: spellCheck ? 'true' : 'false',
              autocorrect: 'on',
              autocapitalize: 'sentences',
            }),
          ),
          trailingActionCompartmentRef.current.of(
            hasTrailingAction ? trailingActionDecorationField : [],
          ),
        ],
      });
      const view = new EditorView({ state, parent: host });
      viewRef.current = view;
      const handleCompositionStart = () => {
        compositionRef.current = true;
      };
      const handleCompositionEnd = () => {
        compositionRef.current = false;
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        const reactEvent = createReactEventProxy<
          KeyboardEvent,
          Parameters<NonNullable<ComposerEditorProps['onKeyDown']>>[0]
        >(event, inputRef.current);
        callbacksRef.current.onKeyDown?.(reactEvent);
        if (event.defaultPrevented) {
          event.stopImmediatePropagation();
          return;
        }
        const isComposing =
          compositionRef.current || event.isComposing || event.keyCode === 229;
        if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        callbacksRef.current.onSubmit?.(
          view.state.doc.toString(),
          readEditorSelection(view),
        );
      };
      const handlePaste = (event: ClipboardEvent) => {
        const reactEvent = createReactEventProxy<
          ClipboardEvent,
          Parameters<NonNullable<ComposerEditorProps['onPaste']>>[0]
        >(event, inputRef.current);
        callbacksRef.current.onPaste?.(reactEvent);
        if (event.defaultPrevented) event.stopImmediatePropagation();
      };
      const handleCompatibilityChange = () => {
        const content = view.contentDOM as HTMLDivElement & {
          value?: string;
          selectionStart?: number;
          selectionEnd?: number;
        };
        const nextValue = compatibilityPendingValueRef.current ?? content.value ?? '';
        compatibilityPendingValueRef.current = null;
        const start =
          typeof content.selectionStart === 'number' ? content.selectionStart : nextValue.length;
        const end = typeof content.selectionEnd === 'number' ? content.selectionEnd : start;
        syncEditorFromCompatibilityInput(nextValue, { start, end });
        callbacksRef.current.onChange(nextValue, { start, end });
      };
      const handleFocus = () => callbacksRef.current.onFocusChange?.(true);
      const handleBlur = () => callbacksRef.current.onFocusChange?.(false);
      view.contentDOM.addEventListener('compositionstart', handleCompositionStart);
      view.contentDOM.addEventListener('compositionend', handleCompositionEnd);
      view.contentDOM.addEventListener('keydown', handleKeyDown, true);
      view.contentDOM.addEventListener('paste', handlePaste, true);
      view.contentDOM.addEventListener('change', handleCompatibilityChange);
      view.contentDOM.addEventListener('focus', handleFocus);
      view.contentDOM.addEventListener('blur', handleBlur);
      syncCompatibilityInput(value, readEditorSelection(view));
      const compatibilityContent = view.contentDOM as HTMLDivElement & {
        value?: string;
      };
      Object.defineProperty(compatibilityContent, 'value', {
        configurable: true,
        get: () => compatibilityPendingValueRef.current ?? view.state.doc.toString(),
        set: (next: string) => {
          compatibilityPendingValueRef.current = String(next);
        },
      });
      if (autoFocus && !effectiveDisabled) view.focus();
      syncEditorHeight();
      syncTrailingActionPosition();
      const handleScroll = () => syncTrailingActionPosition();
      view.scrollDOM.addEventListener('scroll', handleScroll);
      const positionFrame = window.requestAnimationFrame(syncTrailingActionPosition);
      return () => {
        view.contentDOM.removeEventListener('compositionstart', handleCompositionStart);
        view.contentDOM.removeEventListener('compositionend', handleCompositionEnd);
        view.contentDOM.removeEventListener('keydown', handleKeyDown, true);
        view.contentDOM.removeEventListener('paste', handlePaste, true);
        view.contentDOM.removeEventListener('change', handleCompatibilityChange);
        view.contentDOM.removeEventListener('focus', handleFocus);
        view.contentDOM.removeEventListener('blur', handleBlur);
        view.scrollDOM.removeEventListener('scroll', handleScroll);
        window.cancelAnimationFrame(positionFrame);
        view.destroy();
        viewRef.current = null;
      };
      // Runtime reconfiguration below keeps the CodeMirror instance stable.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [baseExtensions, syncEditorFromCompatibilityInput, syncEditorHeight]);

    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      const selection = view.state.selection.main;
      const documentLength = value.length;
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
        selection: {
          anchor: Math.min(selection.anchor, documentLength),
          head: Math.min(selection.head, documentLength),
        },
        scrollIntoView: true,
        annotations: externalValueSyncAnnotation.of(true),
      });
      syncEditorHeight();
    }, [syncEditorHeight, value]);

    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: setComposerEditorTokenConfig.of({
          selectedSkills,
          attachments,
          pastedReferences,
          callbacksRef: tokenCallbacksRef,
          disabled: effectiveDisabled,
        }),
      });
    }, [attachments, effectiveDisabled, pastedReferences, selectedSkills]);

    useLayoutEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: [
          placeholderCompartmentRef.current.reconfigure(
            codeMirrorPlaceholder(effectivePlaceholder),
          ),
          readOnlyCompartmentRef.current.reconfigure(EditorState.readOnly.of(enhancingLocked)),
          editableCompartmentRef.current.reconfigure(EditorView.editable.of(!enhancingLocked)),
          themeCompartmentRef.current.reconfigure(
            composerEditorTheme({
              minHeight: safeMinHeight,
              maxHeight: safeMaxHeight,
              fontSize: chatFontSize,
              fontFamily: serifFontFamily,
            }),
          ),
          attributesCompartmentRef.current.reconfigure(
            EditorView.contentAttributes.of({
              'aria-label': ariaLabel,
              ...(ariaDescribedBy ? { 'aria-describedby': ariaDescribedBy } : {}),
              'aria-disabled': enhancingLocked ? 'true' : 'false',
              spellcheck: spellCheck ? 'true' : 'false',
              autocorrect: 'on',
              autocapitalize: 'sentences',
            }),
          ),
          trailingActionCompartmentRef.current.reconfigure(
            hasTrailingAction ? trailingActionDecorationField : [],
          ),
        ],
      });
      syncTrailingActionPosition();
    }, [
      ariaDescribedBy,
      ariaLabel,
      chatFontSize,
      enhancingLocked,
      effectivePlaceholder,
      hasTrailingAction,
      safeMaxHeight,
      safeMinHeight,
      serifFontFamily,
      spellCheck,
      syncTrailingActionPosition,
    ]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => viewRef.current?.focus(),
        blur: () => viewRef.current?.contentDOM.blur(),
        getSelection: () => {
          const view = viewRef.current;
          return view ? readEditorSelection(view) : { start: value.length, end: value.length };
        },
        setSelectionRange: (start, end, direction) =>
          setEditorSelection(start, end, direction, true),
        containsEventTarget: (target) => {
          const root = rootRef.current;
          return Boolean(
            root && typeof Node !== 'undefined' && target instanceof Node && root.contains(target),
          );
        },
        getInputElement: () => inputRef.current,
        getRootElement: () => rootRef.current,
      }),
      [setEditorSelection, value.length],
    );

    const publishCompatibilitySelection = useCallback(() => {
      const input = inputRef.current;
      if (!input) return;
      const selection = readTextareaSelection(input);
      setEditorSelection(
        selection.start,
        selection.end,
        input.selectionDirection ?? 'none',
        false,
      );
    }, [setEditorSelection]);

    const handleCompatibilityKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
      callbacksRef.current.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      const nativeEvent = event.nativeEvent;
      const isComposing =
        compositionRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229;
      if (event.key !== 'Enter' || event.shiftKey || isComposing) return;
      event.preventDefault();
      callbacksRef.current.onSubmit?.(value, readTextareaSelection(event.currentTarget, value.length));
    };

    const handleDrop: DragEventHandler<HTMLDivElement> = (event) => {
      if (effectiveDisabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onDrop?.(event);
    };
    const handleDragOver: DragEventHandler<HTMLDivElement> = (event) => {
      if (effectiveDisabled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onDragOver?.(event);
    };
    const documentTokens = parseComposerEditorInlineTokens(value);
    const inlineSkillNames = new Set(
      documentTokens.filter((token) => token.kind === 'skill').map((token) => token.value),
    );
    const inlineAttachmentPaths = new Set(
      documentTokens
        .filter((token) => token.kind === 'file' || token.kind === 'folder')
        .map((token) => token.value),
    );
    const inlinePastedIds = new Set(
      documentTokens.filter((token) => token.kind === 'pasted').map((token) => token.value),
    );
    const visibleAttachments = attachments.filter(
      (attachment) => !inlineAttachmentPaths.has(attachment.path),
    );
    const visibleSkills = selectedSkills.filter((skill) => !inlineSkillNames.has(skill.name));
    const visiblePastedReferences = pastedReferences.filter(
      (reference) => !inlinePastedIds.has(reference.id),
    );
    const hasInlineTokens = visibleSkills.length > 0 || visiblePastedReferences.length > 0;

    return (
      <div
        ref={rootRef}
        className={`shell-composer-editor ${
          effectiveDisabled ? 'is-disabled' : ''
        } ${enhancing ? 'is-enhancing' : ''} ${hasTrailingAction ? 'has-trailing-action' : ''} ${className}`.trim()}
        data-testid={testId}
        data-enhancing={enhancing ? 'true' : undefined}
        data-goal-running={goalRunning ? 'true' : undefined}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        style={{ position: 'relative', width: '100%', minWidth: 0, ...style }}
      >
        {visibleAttachments.length > 0 ? (
          <div className="shell-compose__chips" data-testid="composer-editor-attachments">
            {visibleAttachments.map((attachment) => {
              const previewable = attachment.kind === 'image' && Boolean(attachment.previewUrl);
              return (
                <div className="shell-attach-chip" key={attachment.path}>
                  {previewable && onOpenAttachment ? (
                    <button
                      type="button"
                      className="shell-attach-chip__thumb"
                      aria-label={`打开附件 ${attachment.name}`}
                      disabled={effectiveDisabled}
                      onClick={() => onOpenAttachment(attachment)}
                    >
                      <img src={attachment.previewUrl} alt={attachment.name} />
                    </button>
                  ) : previewable ? (
                    <span className="shell-attach-chip__thumb">
                      <img src={attachment.previewUrl} alt={attachment.name} />
                    </span>
                  ) : onOpenAttachment ? (
                    <button
                      type="button"
                      className="shell-attach-chip__icon"
                      aria-label={`打开附件 ${attachment.name}`}
                      disabled={effectiveDisabled}
                      onClick={() => onOpenAttachment(attachment)}
                    >
                      {attachment.kind === 'dir' ? (
                        <Folder size={15} aria-hidden="true" />
                      ) : (
                        <File size={15} aria-hidden="true" />
                      )}
                    </button>
                  ) : (
                    <span className="shell-attach-chip__icon" aria-hidden="true">
                      {attachment.kind === 'dir' ? <Folder size={15} /> : <File size={15} />}
                    </span>
                  )}
                  <span className="shell-attach-chip__name" title={attachment.path}>
                    {attachment.name}
                  </span>
                  {onRemoveAttachment ? (
                    <button
                      type="button"
                      className="shell-attach-chip__remove"
                      aria-label={`移除附件 ${attachment.name}`}
                      disabled={effectiveDisabled}
                      onClick={() => onRemoveAttachment(attachment.path)}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {hasInlineTokens ? (
          <div
            className="shell-compose__selected-skills shell-composer-editor__inline-tokens"
            data-testid="composer-editor-inline-tokens"
          >
            {visibleSkills.map((skill) => (
              <button
                key={skill.skillVersionId}
                type="button"
                className="shell-compose__selected-skill shell-composer-editor__skill-token"
                title={`${skill.name} · v${skill.version}`}
                aria-label={
                  onRemoveSkill ? `移除 Skill ${skill.name}` : `已选择 Skill ${skill.name}`
                }
                disabled={effectiveDisabled || !onRemoveSkill}
                onClick={() => onRemoveSkill?.(skill.skillVersionId)}
              >
                <Puzzle size={13} aria-hidden="true" />
                <span>{skill.name}</span>
                {onRemoveSkill ? (
                  <X
                    size={12}
                    className="shell-compose__selected-skill-remove"
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            ))}
            {visiblePastedReferences.map((reference) => (
              <span
                key={reference.id}
                className="shell-composer-editor__pasted-token"
                style={{ display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 2 }}
              >
                <button
                  type="button"
                  className="shell-compose__selected-skill"
                  title={reference.preview ?? reference.label}
                  aria-label={`打开粘贴引用 ${reference.label}`}
                  disabled={effectiveDisabled || !onOpenPastedReference}
                  onClick={() => onOpenPastedReference?.(reference)}
                >
                  <FileText size={13} aria-hidden="true" />
                  <span>{reference.label}</span>
                </button>
                {onRemovePastedReference ? (
                  <button
                    type="button"
                    className="shell-attach-chip__remove"
                    aria-label={`移除粘贴引用 ${reference.label}`}
                    disabled={effectiveDisabled}
                    onClick={() => onRemovePastedReference(reference.id)}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        ) : null}

        <div
          ref={editorHostRef}
          className={`shell-composer-editor__surface shell-composer-editor__input ${inputClassName}`.trim()}
          style={inputStyle}
        />
        {trailingAction ? (
          <div ref={trailingActionRef} className="shell-composer-editor__trailing-action">
            {trailingAction}
          </div>
        ) : null}
        <textarea
          ref={setInputRef}
          id={inputId}
          name={inputName}
          data-testid={inputTestId}
          className="shell-composer-editor__compat-input"
          value={value}
          aria-hidden="true"
          tabIndex={-1}
          disabled={effectiveDisabled}
          placeholder={effectivePlaceholder}
          spellCheck={spellCheck}
          style={{
            minHeight: `${safeMinHeight}px`,
            maxHeight: `${safeMaxHeight}px`,
            fontSize: `${chatFontSize}px`,
            ...(serifFontFamily ? { fontFamily: serifFontFamily } : {}),
            ...inputStyle,
          }}
          onChange={(event) => {
            const selection = readTextareaSelection(
              event.currentTarget,
              event.currentTarget.value.length,
            );
            syncEditorFromCompatibilityInput(event.currentTarget.value, selection);
            callbacksRef.current.onChange(event.currentTarget.value, selection);
            callbacksRef.current.onSelectionChange?.(selection);
            syncEditorHeight();
          }}
          onKeyDown={handleCompatibilityKeyDown}
          onPaste={onPaste}
          onClick={publishCompatibilitySelection}
          onSelect={publishCompatibilitySelection}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          onCompositionStart={() => {
            compositionRef.current = true;
          }}
          onCompositionEnd={() => {
            compositionRef.current = false;
            publishCompatibilitySelection();
          }}
          rows={1}
        />
      </div>
    );
  },
);
