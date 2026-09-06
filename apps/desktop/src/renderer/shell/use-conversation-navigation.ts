import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationId } from '@sync-think/shared';
import {
  ConversationNavigationLoader,
  EMPTY_NAVIGATION_DIRECTORY,
  type NavigationDirectorySnapshot,
} from './conversation-navigation-loader.js';

export function useConversationNavigation(
  conversationId: string,
  enabled: boolean,
  scopeKey = conversationId,
) {
  const available = enabled && Boolean(window.syncThink?.runtime?.listConversationNavigation);
  const loaderRef = useRef<ConversationNavigationLoader>();
  const [state, setState] = useState<{ scopeKey: string; snapshot: NavigationDirectorySnapshot }>();
  useEffect(() => {
    if (!available) return;
    const loader = new ConversationNavigationLoader({
      load: (beforeSequence) =>
        window.syncThink!.runtime.listConversationNavigation({
          conversationId: conversationId as ConversationId,
          beforeSequence,
          limit: 200,
        }),
      onChange: (snapshot) => setState({ scopeKey, snapshot }),
    });
    loaderRef.current = loader;
    void loader.refresh();
    return () => {
      loader.dispose();
      if (loaderRef.current === loader) loaderRef.current = undefined;
    };
  }, [available, conversationId, scopeKey]);
  const refresh = useCallback(() => {
    void loaderRef.current?.refresh();
  }, []);
  return {
    ...(available && state?.scopeKey === scopeKey ? state.snapshot : EMPTY_NAVIGATION_DIRECTORY),
    refresh,
  };
}
