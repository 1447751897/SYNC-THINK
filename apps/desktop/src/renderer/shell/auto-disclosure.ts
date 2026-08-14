import { useCallback, useEffect, useRef, useState } from 'react';

export function useAutoDisclosure(input: { autoOpen: boolean; resetKey?: string }) {
  const { autoOpen, resetKey } = input;
  const [open, setOpen] = useState(autoOpen);
  const manualOverrideRef = useRef(false);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      manualOverrideRef.current = false;
      setOpen(autoOpen);
      return;
    }
    if (!manualOverrideRef.current) setOpen(autoOpen);
  }, [autoOpen, resetKey]);

  const toggle = useCallback(() => {
    manualOverrideRef.current = true;
    setOpen((value) => !value);
  }, []);

  return { open, toggle };
}
