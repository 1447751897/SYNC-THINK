import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';

const TaskSheetPortalContext = createContext<HTMLElement | undefined>(undefined);

/** Menus must share the modal's scroll boundary, not portal into document.body. */
export function useTaskSheetPortalContainer(): HTMLElement | undefined {
  return useContext(TaskSheetPortalContext);
}

/** A single surface for task creation, editing, details and run history. */
export function TaskSheet({
  title,
  description,
  children,
  footer,
  onClose,
  busy = false,
  testId,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  onClose(): void;
  busy?: boolean;
  testId?: string;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="task-sheet-backdrop" />
        <TaskSheetPortalContext.Provider value={portalContainer ?? undefined}>
          <Dialog.Content
            ref={setPortalContainer}
            className="task-sheet"
            data-testid={testId}
            onEscapeKeyDown={(event) => {
              if (busy) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <header className="task-sheet__head">
              <div>
                <Dialog.Title>{title}</Dialog.Title>
                <Dialog.Description>{description}</Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="task-sheet__close"
                  aria-label="关闭面板"
                  disabled={busy}
                >
                  <X size={16} />
                </button>
              </Dialog.Close>
            </header>
            <div className="task-sheet__body">{children}</div>
            <footer className="task-sheet__foot">{footer}</footer>
          </Dialog.Content>
        </TaskSheetPortalContext.Provider>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
