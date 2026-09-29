import { useEffect, useRef, type ButtonHTMLAttributes } from 'react';

type MotionModule = typeof import('motion/mini');
let motionModule: Promise<MotionModule> | undefined;
const loadMotion = () => (motionModule ??= import('motion/mini'));

/** Load Be UI's press feedback on interaction, not in the desktop startup bundle. */
export function CodeBlockButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef(0);
  const animationRef = useRef<ReturnType<MotionModule['animate']>>();
  useEffect(
    () => () => {
      requestRef.current += 1;
      animationRef.current?.stop();
    },
    [],
  );
  const preload = () => {
    void loadMotion().catch(() => {
      motionModule = undefined;
    });
  };
  const press = (pressed: boolean) => {
    const target = buttonRef.current;
    if (!target?.animate) return;
    const request = ++requestRef.current;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      animationRef.current?.cancel();
      target.style.transform = '';
      return;
    }
    void loadMotion()
      .then(({ animate }) => {
        if (request !== requestRef.current || !target.isConnected) return;
        animationRef.current?.stop();
        animationRef.current = animate(
          target,
          { transform: pressed ? 'scale(0.9)' : 'scale(1)' },
          {
            duration: pressed ? 0.1 : 0.16,
            ease: [0.2, 0.8, 0.2, 1],
          },
        );
      })
      .catch(() => {
        motionModule = undefined;
      }); // Copy/expand still work if optional animation fails.
  };
  return (
    <button
      {...props}
      ref={buttonRef}
      onPointerEnter={(event) => {
        props.onPointerEnter?.(event);
        preload();
      }}
      onFocus={(event) => {
        props.onFocus?.(event);
        preload();
      }}
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        if (event.button === 0 && !event.defaultPrevented) press(true);
      }}
      onPointerUp={(event) => {
        props.onPointerUp?.(event);
        press(false);
      }}
      onPointerLeave={(event) => {
        props.onPointerLeave?.(event);
        press(false);
      }}
      onPointerCancel={(event) => {
        props.onPointerCancel?.(event);
        press(false);
      }}
      onBlur={(event) => {
        props.onBlur?.(event);
        press(false);
      }}
      onKeyDown={(event) => {
        props.onKeyDown?.(event);
        if (!event.defaultPrevented && ['Enter', ' '].includes(event.key)) press(true);
      }}
      onKeyUp={(event) => {
        props.onKeyUp?.(event);
        if (['Enter', ' '].includes(event.key)) press(false);
      }}
    />
  );
}
