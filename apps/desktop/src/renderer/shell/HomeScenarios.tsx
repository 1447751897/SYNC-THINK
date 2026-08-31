import { Settings2 } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';

export interface HomeScenarioTemplate {
  title: string;
  description: string;
  prompt: string;
}

export interface HomeScenario {
  id: string;
  label: string;
  description: string;
  templates: readonly HomeScenarioTemplate[];
}

export const DEFAULT_HOME_SCENARIOS: readonly HomeScenario[] = [
  {
    id: 'research',
    label: '研究',
    description: '调研资料、核对来源并形成结论',
    templates: [
      {
        title: '快速调研',
        description: '关键事实、分歧与来源',
        prompt: '请先询问我要研究的主题和时间范围，再给出带来源的关键事实、分歧点和结论。',
      },
      {
        title: '竞品分析',
        description: '定位、能力和差异比较',
        prompt: '请先询问竞品名称和目标市场，再从定位、核心能力、价格、用户反馈和风险五个方面完成竞品分析。',
      },
    ],
  },
  {
    id: 'writing',
    label: '写作',
    description: '撰写、改写和校对内容',
    templates: [
      {
        title: '专业文章',
        description: '从读者和目标开始成稿',
        prompt: '请先询问文章主题、目标读者、发布渠道和字数，再给出可直接发布的完整文章。',
      },
      {
        title: '工作邮件',
        description: '清楚、简洁、可发送',
        prompt: '请先询问收件人、邮件目的和必须包含的信息，再起草一封简洁专业的工作邮件。',
      },
    ],
  },
  {
    id: 'slides',
    label: 'PPT',
    description: '规划演示结构和逐页内容',
    templates: [
      {
        title: '演示大纲',
        description: '叙事线与逐页要点',
        prompt: '请先询问演示主题、受众、时长和预期行动，再输出逐页标题、核心内容和讲述要点。',
      },
      {
        title: '项目汇报',
        description: '进展、问题与下一步',
        prompt: '请先询问项目背景、当前进展、关键数据和待决策事项，再形成一份项目汇报演示结构。',
      },
    ],
  },
  {
    id: 'data',
    label: '数据',
    description: '分析数据趋势和异常',
    templates: [
      {
        title: '趋势分析',
        description: '趋势、异常和建议',
        prompt: '请先让我提供数据或文件，再分析主要趋势、异常点、可能原因和可执行建议。',
      },
      {
        title: '指标复盘',
        description: '目标对比与影响因素',
        prompt: '请先询问指标口径、目标值、实际值和统计周期，再完成差距分析与下一步行动建议。',
      },
    ],
  },
  {
    id: 'coding',
    label: '编程',
    description: '实现功能、修复问题和审查代码',
    templates: [
      {
        title: '实现功能',
        description: '先核对仓库再落地验证',
        prompt: '请先阅读当前仓库的相关实现和测试，确认影响范围后实现需求，并运行与风险相称的验证。',
      },
      {
        title: '定位缺陷',
        description: '复现、根因、回归测试',
        prompt: '请复现我描述的问题，定位根因，添加能捕获该问题的回归测试，然后完成修复和验证。',
      },
    ],
  },
  {
    id: 'meeting',
    label: '会议',
    description: '整理会议结论和待办',
    templates: [
      {
        title: '整理纪要',
        description: '议题、结论和责任人',
        prompt: '请让我提供会议转写或笔记，再整理为议题、关键结论、待办事项、负责人和时间节点。',
      },
      {
        title: '会前准备',
        description: '目标、议程和问题清单',
        prompt: '请先询问会议目标、参与者和背景材料，再生成议程、关键问题与会前准备清单。',
      },
    ],
  },
  {
    id: 'design',
    label: '设计',
    description: '梳理产品与界面设计方向',
    templates: [
      {
        title: '产品方案',
        description: '用户、问题和闭环',
        prompt: '请先询问目标用户、核心问题、现有方案和约束，再输出包含用户流程、功能边界和验证指标的产品方案。',
      },
      {
        title: '界面审查',
        description: '层级、排版和交互',
        prompt: '请审查我提供的界面或代码，从信息层级、排版、状态、响应式和可访问性给出具体修改建议。',
      },
    ],
  },
  {
    id: 'translation',
    label: '翻译',
    description: '按语境完成准确翻译',
    templates: [
      {
        title: '专业翻译',
        description: '保留语气和术语',
        prompt: '请先询问目标语言、读者和术语要求，再翻译我提供的内容并保留原文语气。',
      },
      {
        title: '双语润色',
        description: '校对表达与一致性',
        prompt: '请让我提供原文和译文，再逐段校对准确性、自然度与术语一致性，并给出修订稿。',
      },
    ],
  },
] as const;

const MAX_VISIBLE_SCENARIO_PILLS = 6;
const PILL_GAP = 4;
const MANAGE_BUTTON_WIDTH = 28;
const MORE_BUTTON_WIDTH = 64;

function estimatePillWidth(label: string): number {
  return Math.min(144, Math.max(56, Array.from(label).length * 13 + 24));
}

function visibleScenarioCount(scenarios: readonly HomeScenario[], width: number): number {
  const capped = Math.min(MAX_VISIBLE_SCENARIO_PILLS, scenarios.length);
  if (width <= 0) return capped;
  let used = MANAGE_BUTTON_WIDTH;
  let count = 0;
  for (let index = 0; index < capped; index += 1) {
    const pillWidth = estimatePillWidth(scenarios[index].label);
    const leavesOverflow = scenarios.length > index + 1;
    const reserved = leavesOverflow ? PILL_GAP + MORE_BUTTON_WIDTH : 0;
    if (used + PILL_GAP + pillWidth + reserved > width && count > 0) break;
    used += PILL_GAP + pillWidth;
    count += 1;
  }
  return Math.max(1, count);
}

export interface HomeScenariosProps {
  scenarios?: readonly HomeScenario[];
  className?: string;
  onSelectTemplate(prompt: string): void;
  onManage?(): void;
}

export const HomeScenarios = memo(function HomeScenarios({
  scenarios = DEFAULT_HOME_SCENARIOS,
  className,
  onSelectTemplate,
  onManage,
}: HomeScenariosProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const [maxVisible, setMaxVisible] = useState(() =>
    Math.min(MAX_VISIBLE_SCENARIO_PILLS, scenarios.length),
  );
  const [activeScenarioId, setActiveScenarioId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId);
  const visible = scenarios.slice(0, maxVisible);
  const overflow = scenarios.slice(maxVisible);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const update = (width: number) => setMaxVisible(visibleScenarioCount(scenarios, width));
    const observer = new ResizeObserver((entries) => {
      update(entries[0]?.contentRect.width ?? container.clientWidth);
    });
    observer.observe(container);
    if (container.clientWidth > 0) update(container.clientWidth);
    return () => observer.disconnect();
  }, [scenarios]);

  useEffect(() => {
    if (!moreOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !moreRef.current?.contains(target)) setMoreOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [moreOpen]);

  const selectScenario = (scenario: HomeScenario) => {
    setActiveScenarioId((current) => (current === scenario.id ? null : scenario.id));
    setMoreOpen(false);
  };

  return (
    <section
      ref={containerRef}
      className={`shell-empty-newmax-scenarios${className ? ` ${className}` : ''}`}
      aria-label="常用场景"
      data-testid="home-scenarios"
    >
      <div className="shell-empty-newmax-scenarios__pills">
        {visible.map((scenario) => (
          <button
            key={scenario.id}
            type="button"
            data-testid="home-scenario-pill"
            className="shell-empty-newmax-scenarios__pill"
            aria-pressed={activeScenarioId === scenario.id}
            title={scenario.description}
            onClick={() => selectScenario(scenario)}
          >
            {scenario.label}
          </button>
        ))}
        {overflow.length > 0 ? (
          <div ref={moreRef} className="shell-empty-newmax-scenarios__more-wrap">
            <button
              type="button"
              className="shell-empty-newmax-scenarios__pill"
              aria-label="更多场景"
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((current) => !current)}
            >
              更多
            </button>
            {moreOpen ? (
              <div className="shell-empty-newmax-scenarios__menu" role="menu" aria-label="更多场景">
                {overflow.map((scenario) => (
                  <button
                    key={scenario.id}
                    type="button"
                    role="menuitem"
                    onClick={() => selectScenario(scenario)}
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          className="shell-empty-newmax-scenarios__manage"
          aria-label="管理场景"
          title={onManage ? '管理场景' : '当前使用内置场景模板'}
          disabled={!onManage}
          onClick={onManage}
        >
          <Settings2 size={15} aria-hidden="true" />
        </button>
      </div>

      {activeScenario ? (
        <div className="shell-empty-newmax-scenarios__templates" aria-label={`${activeScenario.label}模板`}>
          {activeScenario.templates.map((template) => (
            <button
              key={template.title}
              type="button"
              className="shell-empty-newmax-scenarios__template"
              onClick={() => onSelectTemplate(template.prompt)}
            >
              <strong>{template.title}</strong>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
});
