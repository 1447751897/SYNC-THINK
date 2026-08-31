import { Lightbulb } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

export const TIP_ROTATE_INTERVAL_MS = 7_000;
export const TIP_FADE_DURATION_MS = 500;

export const DEFAULT_HOME_TIPS = [
  '输入 / 可打开快捷命令与 Skill',
  '使用 @ 引用工作区文件或开启联网搜索',
  '图片和文件可以直接拖入输入框',
  '规划模式会先形成可审批的执行方案',
  '目标模式会持续推进，直到目标完成',
  '按 Shift + Tab 可接受 Plan 或 Goal 建议',
  '可在模型菜单中调整模型与推理强度',
  '工作区文件可以作为当前消息的上下文',
  '空输入时可使用语音按钮快速输入',
  '正式方案与运行任务清单分别呈现',
  '加号菜单集中管理输入相关能力',
  '可在偏好设置中调整字体和主题',
  '按 Ctrl + , 快速打开设置',
] as const;

export interface TipsCarouselProps {
  tips?: readonly string[];
  className?: string;
}

function reducedMotionEnabled(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-reduced-motion')) {
    return true;
  }
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export const TipsCarousel = memo(function TipsCarousel({
  tips = DEFAULT_HOME_TIPS,
  className,
}: TipsCarouselProps) {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const fadeTimeoutRef = useRef<number | null>(null);
  const displayTips = tips.length > 0 ? tips : DEFAULT_HOME_TIPS;

  useEffect(() => {
    setIndex((current) => current % displayTips.length);
    if (displayTips.length <= 1) return;
    const interval = window.setInterval(() => {
      if (reducedMotionEnabled()) {
        setFading(false);
        setIndex((current) => (current + 1) % displayTips.length);
        return;
      }
      setFading(true);
      fadeTimeoutRef.current = window.setTimeout(() => {
        setIndex((current) => (current + 1) % displayTips.length);
        setFading(false);
        fadeTimeoutRef.current = null;
      }, TIP_FADE_DURATION_MS);
    }, TIP_ROTATE_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      if (fadeTimeoutRef.current !== null) window.clearTimeout(fadeTimeoutRef.current);
      fadeTimeoutRef.current = null;
    };
  }, [displayTips.length]);

  return (
    <div
      className={`shell-empty-newmax-tips${className ? ` ${className}` : ''}`}
      data-testid="home-tips-carousel"
      data-fading={fading ? 'true' : 'false'}
    >
      <span className="shell-empty-newmax-tips__icon" aria-hidden="true">
        <Lightbulb size={18} />
      </span>
      <span className="shell-empty-newmax-tips__text" data-testid="home-tip-text">
        {displayTips[index % displayTips.length]}
      </span>
    </div>
  );
});
