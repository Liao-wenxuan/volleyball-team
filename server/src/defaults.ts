import type { TemplateItem } from './repo';

/** 默认训练模板：周二 / 周五 16:30–18:30，周日 08:30–11:30（跟前端一致） */
export const DEFAULT_TEMPLATE: TemplateItem[] = [
  { id: 'tue', day: 2, label: '周二', start: '16:30', end: '18:30', venue: '' },
  { id: 'fri', day: 5, label: '周五', start: '16:30', end: '18:30', venue: '' },
  { id: 'sun', day: 0, label: '周日', start: '08:30', end: '11:30', venue: '' }
];

/** 默认防守站位（半场 9×9m，y 从网起算） */
export const DEFAULT_FORMATION = {
  preset: 'base',
  pos: {
    oh1: { x: 1.8, y: 5.6 },
    oh2: { x: 7.0, y: 5.9 },
    mb: { x: 4.5, y: 0.85 },
    opp: { x: 2.6, y: 1.35 },
    s: { x: 6.3, y: 1.1 },
    lib: { x: 4.5, y: 7.0 }
  }
};

export const SKILL_DEFAULTS = { serve: 5, receive: 5, set: 5, spike: 5, block: 5, defense: 5 };
