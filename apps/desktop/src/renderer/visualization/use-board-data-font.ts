import { useEffect, useState, useCallback } from 'react';
import { boardDataFontReady, loadBoardDataFont } from './board-data-font-loader.js';
export function useBoardDataFont(required: boolean) {
  const [ready, setReady] = useState(boardDataFontReady);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    if (!required || boardDataFontReady()) {
      if (boardDataFontReady()) setReady(true);
      return;
    }
    let current = true;
    loadBoardDataFont()
      .then(() => {
        if (current) setReady(true);
      })
      .catch(() => {
        if (current) setError('数据组件字体加载失败，请重试。');
      });
    return () => {
      current = false;
    };
  }, [required, attempt]);
  return { ready: !required || ready, error: required ? error : null, retry };
}
