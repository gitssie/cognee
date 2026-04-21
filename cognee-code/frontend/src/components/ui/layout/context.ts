import type { ComputedRef, InjectionKey, Ref } from 'vue';

export interface UILayoutScrollState {
  position: number;
  direction: 'up' | 'down';
  inflectionPoint: number;
  delta: number;
}

export interface UILayoutRows {
  top: string[];
  middle: string[];
  bottom: string[];
}

export interface UILayoutSectionState {
  size: number;
  offset: number;
  space: boolean;
}

export interface UILayoutContext {
  view: ComputedRef<string>;
  rows: ComputedRef<UILayoutRows>;
  isContainer: ComputedRef<boolean>;
  rootRef: Ref<HTMLElement | null>;
  height: Ref<number>;
  width: Ref<number>;
  containerHeight: Ref<number>;
  scrollbarWidth: Ref<number>;
  totalWidth: ComputedRef<number>;
  scroll: Ref<UILayoutScrollState>;
  header: UILayoutSectionState;
  right: UILayoutSectionState;
  footer: UILayoutSectionState;
  left: UILayoutSectionState;
  update: (part: 'header' | 'right' | 'footer' | 'left', prop: keyof UILayoutSectionState, value: number | boolean) => void;
}

export const uiLayoutKey: InjectionKey<UILayoutContext> = Symbol('ui-layout');
export const uiPageContainerKey: InjectionKey<boolean> = Symbol('ui-layout-page-container');

export function validateLayoutView(view: string): boolean {
  return /^(h|l)h(h|r) lpr (f|l)f(f|r)$/i.test(view);
}

export function parseLayoutView(view: string): UILayoutRows {
  const [top = 'hhh', middle = 'lpr', bottom = 'fff'] = view.toLowerCase().split(' ');

  return {
    top: top.split(''),
    middle: middle.split(''),
    bottom: bottom.split(''),
  };
}

export function getScrollbarWidth(): number {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return 0;
  }

  const scrollDiv = document.createElement('div');
  scrollDiv.style.width = '100px';
  scrollDiv.style.height = '100px';
  scrollDiv.style.position = 'absolute';
  scrollDiv.style.top = '-9999px';
  scrollDiv.style.overflow = 'scroll';
  document.body.appendChild(scrollDiv);

  const scrollbarWidth = scrollDiv.offsetWidth - scrollDiv.clientWidth;
  document.body.removeChild(scrollDiv);

  return scrollbarWidth;
}
