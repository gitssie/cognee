import { QResizeObserver, QScrollObserver, useQuasar } from 'quasar';
import { computed, defineComponent, h, provide, reactive, ref } from 'vue';
import type { VNodeChild } from 'vue';
import { getScrollbarWidth, parseLayoutView, uiLayoutKey, validateLayoutView, type UILayoutContext, type UILayoutScrollState } from './context';

export const uiLayoutProps = {
  container: {
    type: Boolean,
    default: false,
  },
  view: {
    type: String,
    default: 'hhh lpr fff',
    validator: validateLayoutView,
  },
};

export const UILayout = defineComponent({
  name: 'UILayout',
  props: uiLayoutProps,
  emits: ['scroll', 'scrollHeight', 'resize'],
  setup(props, { slots, emit }) {
    const $q = useQuasar();
    const rootRef = ref<HTMLElement | null>(null);
    const height = ref($q.screen.height || 0);
    const width = ref(props.container === true ? 0 : $q.screen.width || 0);
    const containerHeight = ref(0);
    const scrollbarWidth = ref(getScrollbarWidth());
    const scroll = ref<UILayoutScrollState>({
      position: 0,
      direction: 'down',
      inflectionPoint: 0,
      delta: 0,
    });

    const rows = computed(() => parseLayoutView(props.view));

    const $layout: UILayoutContext = {
      view: computed(() => props.view),
      rows,
      isContainer: computed(() => props.container),
      rootRef,
      height,
      width,
      containerHeight,
      scrollbarWidth,
      totalWidth: computed(() => width.value + scrollbarWidth.value),
      scroll,
      header: reactive({ size: 0, offset: 0, space: false }),
      right: reactive({ size: 300, offset: 0, space: false }),
      footer: reactive({ size: 0, offset: 0, space: false }),
      left: reactive({ size: 300, offset: 0, space: false }),
      update(part, prop, value) {
        if (prop === 'space') {
          $layout[part].space = Boolean(value);
          return;
        }

        $layout[part][prop] = Number(value);
      },
    };

    provide(uiLayoutKey, $layout);

    const classes = computed(() => `ui-layout ui-layout--${props.container === true ? 'containerized' : 'standard'} relative`);
    const style = computed(() => (props.container === true ? null : { minHeight: `${$q.screen.height || height.value}px` }));
    const targetStyle = computed(() => (scrollbarWidth.value !== 0 ? { [$q.lang.rtl === true ? 'left' : 'right']: `${scrollbarWidth.value}px` } : null));
    const targetChildStyle = computed(() =>
      scrollbarWidth.value !== 0
        ? {
            [$q.lang.rtl === true ? 'right' : 'left']: 0,
            [$q.lang.rtl === true ? 'left' : 'right']: `-${scrollbarWidth.value}px`,
            width: `calc(100% + ${scrollbarWidth.value}px)`,
          }
        : null,
    );

    const updateScrollbar = () => {
      if (props.container !== true) {
        scrollbarWidth.value = getScrollbarWidth();
        return;
      }

      scrollbarWidth.value = height.value > containerHeight.value ? getScrollbarWidth() : 0;
    };

    const onPageScroll = (data: { position?: { top?: number }; direction?: 'up' | 'down'; inflectionPoint?: { top?: number }; delta?: { top?: number } }) => {
      const info: UILayoutScrollState = {
        position: data.position?.top || 0,
        direction: data.direction || 'down',
        inflectionPoint: data.inflectionPoint?.top || 0,
        delta: data.delta?.top || 0,
      };

      scroll.value = info;
      emit('scroll', info);
    };

    const onPageResize = (data: { height: number; width: number }) => {
      if (height.value !== data.height) {
        height.value = data.height;
        emit('scrollHeight', data.height);
      }

      if (width.value !== data.width) {
        width.value = data.width;
      }

      updateScrollbar();
      emit('resize', data);
    };

    const onContainerResize = (data: { height: number; width: number }) => {
      if (containerHeight.value !== data.height) {
        containerHeight.value = data.height;
      }
      if (width.value !== data.width) {
        width.value = data.width;
      }
      updateScrollbar();
      emit('resize', data);
    };

    const renderObservers = (): VNodeChild[] => [h(QScrollObserver, { onScroll: onPageScroll }), h(QResizeObserver, { onResize: onPageResize })];

    return () => {
      const content = [...(slots.default?.() || []), ...renderObservers()];

      const layoutNodeProps: Record<string, unknown> = {
        class: classes.value,
        tabindex: -1,
      };

      if (style.value) {
        layoutNodeProps.style = style.value;
      }
      if (props.container !== true) {
        layoutNodeProps.ref = rootRef;
      }

      const layoutNode = h('div', layoutNodeProps, content);

      if (props.container === true) {
        return h(
          'div',
          {
            class: 'ui-layout-container relative overflow-hidden',
            ref: rootRef,
            style: { width: '100%', height: '100%', minHeight: 0, minWidth: 0 },
          },
          [
            h(QResizeObserver, { onResize: onContainerResize }),
            h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: '0',
                  right: targetStyle.value?.right || '0',
                  bottom: '0',
                  left: targetStyle.value?.left || '0',
                },
              },
              [
                h(
                  'div',
                  {
                    style: {
                      ...(targetChildStyle.value || {}),
                      minHeight: 0,
                      maxHeight: '100%',
                      height: '100%',
                      overflow: 'hidden',
                    },
                  },
                  [layoutNode],
                ),
              ],
            ),
          ],
        );
      }

      return layoutNode;
    };
  },
});

export default UILayout;
