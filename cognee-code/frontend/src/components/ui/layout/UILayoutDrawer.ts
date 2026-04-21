import { useQuasar } from 'quasar';
import { computed, defineComponent, h, inject, onBeforeUnmount, ref, watch } from 'vue';
import { uiLayoutKey, type UILayoutContext } from './context';

export const uiLayoutDrawerProps = {
  modelValue: {
    type: Boolean,
    default: true,
  },
  side: {
    type: String as () => 'left' | 'right',
    default: 'left',
  },
  width: {
    type: Number,
    default: 300,
  },
  mini: {
    type: Boolean,
    default: false,
  },
  miniToOverlay: {
    type: Boolean,
    default: false,
  },
  miniWidth: {
    type: Number,
    default: 57,
  },
  breakpoint: {
    type: Number,
    default: 1023,
  },
  showIfAbove: {
    type: Boolean,
    default: false,
  },
  behavior: {
    type: String as () => 'default' | 'desktop' | 'mobile',
    default: 'default',
  },
  bordered: {
    type: Boolean,
    default: false,
  },
  elevated: {
    type: Boolean,
    default: false,
  },
  overlay: {
    type: Boolean,
    default: false,
  },
  persistent: {
    type: Boolean,
    default: false,
  },
};

export const UILayoutDrawer = defineComponent({
  name: 'UILayoutDrawer',
  props: uiLayoutDrawerProps,
  emits: ['update:modelValue', 'show', 'hide', 'onLayout', 'miniState'],
  setup(props, { slots, emit, attrs }) {
    const $q = useQuasar();
    const $layout = inject<UILayoutContext | undefined>(uiLayoutKey, undefined);

    if (!$layout) {
      console.error('UILayoutDrawer needs to be child of UILayout');
      return () => null;
    }

    const localShowing = ref(false);
    const belowBreakpoint = ref(false);
    const contentPosition = ref(0);
    const backdropOpacity = ref(0);

    const rightSide = computed(() => props.side === 'right');
    const stateDirection = computed(() => ($q.lang.rtl === true ? -1 : 1) * (rightSide.value === true ? 1 : -1));
    const isMini = computed(() => props.mini === true && belowBreakpoint.value !== true);
    const size = computed(() => (isMini.value === true ? props.miniWidth : props.width));
    const fixed = computed(() => props.overlay === true || props.miniToOverlay === true || $layout.view.value.includes(rightSide.value === true ? 'R' : 'L'));
    const onLayout = computed(() => props.overlay === false && localShowing.value === true && belowBreakpoint.value === false);
    const onScreenOverlay = computed(() => props.overlay === true && localShowing.value === true && belowBreakpoint.value === false);
    const shouldUseFixed = computed(() => (belowBreakpoint.value === true || fixed.value === true || onLayout.value !== true) && $layout.isContainer.value !== true);
    const offset = computed(() => (onLayout.value === true ? (props.miniToOverlay === true ? props.miniWidth : size.value) : 0));
    const headerSlot = computed(() => (rightSide.value === true ? $layout.rows.value.top[2] === 'r' : $layout.rows.value.top[0] === 'l'));
    const footerSlot = computed(() => (rightSide.value === true ? $layout.rows.value.bottom[2] === 'r' : $layout.rows.value.bottom[0] === 'l'));

    const updateBelowBreakpoint = () => {
      belowBreakpoint.value = props.behavior === 'mobile' || (props.behavior !== 'desktop' && $layout.totalWidth.value <= props.breakpoint);
    };

    const normalizedModel = computed(() => (props.showIfAbove === true && belowBreakpoint.value === false ? true : props.modelValue));

    const applyPosition = () => {
      if (localShowing.value === true) {
        contentPosition.value = 0;
        backdropOpacity.value = belowBreakpoint.value === true || onScreenOverlay.value === true ? 1 : 0;
        return;
      }

      let nextPosition = size.value * stateDirection.value;
      if ($layout.isContainer.value === true && rightSide.value === true && $layout.scrollbarWidth.value > 0) {
        nextPosition += stateDirection.value * $layout.scrollbarWidth.value;
      }
      contentPosition.value = nextPosition;
      backdropOpacity.value = 0;
    };

    const aboveStyle = computed(() => {
      const css: Record<string, string> = {};

      if ($layout.header.space === true && headerSlot.value === false) {
        css.top = `${fixed.value === true ? $layout.header.offset : $layout.header.size}px`;
      }

      if ($layout.footer.space === true && footerSlot.value === false) {
        css.bottom = `${fixed.value === true ? $layout.footer.offset : $layout.footer.size}px`;
      }

      return css;
    });

    const style = computed<Record<string, string>>(() => ({
      width: `${size.value}px`,
      transform: `translateX(${contentPosition.value}px)`,
      ...(belowBreakpoint.value === true ? {} : aboveStyle.value),
    }));

    const classes = computed(
      () =>
        `ui-layout__drawer ui-layout__drawer--${props.side} ${isMini.value === true ? 'ui-layout__drawer--mini' : 'ui-layout__drawer--standard'}${props.bordered === true ? ` border-${rightSide.value === true ? 'left' : 'right'}` : ''}`,
    );

    const contentClass = computed(() => `${$layout.isContainer.value === true ? 'overflow-auto' : 'scroll'} fit`);

    const setShowing = (value: boolean) => {
      if (normalizedModel.value === true && value === false && props.showIfAbove === true && belowBreakpoint.value === false) {
        return;
      }

      localShowing.value = value;
      emit(value === true ? 'show' : 'hide');

      if (props.modelValue !== value) {
        emit('update:modelValue', value);
      }
    };

    watch($layout.totalWidth, updateBelowBreakpoint, { immediate: true });
    watch(() => props.behavior, updateBelowBreakpoint);
    watch(() => props.breakpoint, updateBelowBreakpoint);
    watch(
      normalizedModel,
      (value) => {
        localShowing.value = value;
        applyPosition();
      },
      { immediate: true },
    );
    watch([size, fixed, belowBreakpoint, () => props.overlay, () => props.miniToOverlay, () => $q.lang.rtl], applyPosition, { immediate: true });
    watch(offset, (value) => $layout.update(props.side, 'offset', value), { immediate: true });
    watch(
      onLayout,
      (value) => {
        $layout.update(props.side, 'space', value);
        emit('onLayout', value);
      },
      { immediate: true },
    );
    watch(isMini, (value) => emit('miniState', value), { immediate: true });
    watch(size, (value) => $layout.update(props.side, 'size', props.miniToOverlay === true ? props.miniWidth : value), { immediate: true });

    onBeforeUnmount(() => {
      $layout.update(props.side, 'size', 0);
      $layout.update(props.side, 'offset', 0);
      $layout.update(props.side, 'space', false);
    });

    return () => {
      const children = [];

      if (belowBreakpoint.value === true || onScreenOverlay.value === true) {
        children.push(
          h('div', {
            class: localShowing.value === true ? '' : 'hidden',
            style: {
              position: $layout.isContainer.value === true ? 'absolute' : 'fixed',
              inset: '0',
              backgroundColor: `rgba(0, 0, 0, ${backdropOpacity.value * 0.4})`,
              zIndex: 1998,
            },
            onClick: () => setShowing(false),
          }),
        );
      }

      const drawerContent = isMini.value === true && slots.mini ? slots.mini() : slots.default?.() || [];
      const contentChildren = [
        h(
          'div',
          {
            ...attrs,
            class: [contentClass.value, attrs.class],
          },
          drawerContent,
        ),
      ];

      if (props.elevated === true && localShowing.value === true) {
        contentChildren.push(h('div', { class: 'no-pointer-events', style: { position: 'absolute', inset: '0', boxShadow: '0 0 12px rgba(0,0,0,.16)' } }));
      }

      children.push(
        h(
          'aside',
          {
            class: classes.value,
            style: {
              ...style.value,
              position: shouldUseFixed.value ? 'fixed' : 'absolute',
              top: style.value.top || '0',
              bottom: style.value.bottom || '0',
              zIndex: belowBreakpoint.value === true || props.overlay === true ? 2000 : 1000,
              background: 'var(--q-color-white, #fff)',
              transition: 'transform .15s ease, width .15s ease, top .15s ease, bottom .15s ease',
              [rightSide.value === true ? 'right' : 'left']: '0',
            },
          },
          contentChildren,
        ),
      );

      return h('div', { class: 'ui-layout__drawer-container' }, children);
    };
  },
});

export default UILayoutDrawer;
