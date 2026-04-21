import { QResizeObserver, useQuasar } from 'quasar';
import { computed, defineComponent, h, inject, onBeforeUnmount, ref, watch, type PropType } from 'vue';
import { uiLayoutKey, type UILayoutContext } from './context';

export const UILayoutFooter = defineComponent({
  name: 'UILayoutFooter',
  props: {
    modelValue: {
      type: Boolean,
      default: true,
    },
    reveal: {
      type: Boolean,
      default: false,
    },
    revealOffset: {
      type: Number,
      default: 250,
    },
    bordered: {
      type: Boolean,
      default: false,
    },
    elevated: {
      type: Boolean,
      default: false,
    },
    heightHint: {
      type: [String, Number] as PropType<string | number>,
      default: 50,
    },
  },
  emits: ['reveal'],
  setup(props, { slots, emit }) {
    const $q = useQuasar();
    const $layout = inject<UILayoutContext | undefined>(uiLayoutKey, undefined);

    if (!$layout) {
      console.error('UILayoutFooter needs to be child of UILayout');
      return () => null;
    }

    const size = ref(parseInt(String(props.heightHint), 10) || 0);
    const revealed = ref(true);

    const fixed = computed(() => props.reveal === true || $layout.view.value.includes('F'));
    const offset = computed(() => {
      if (props.modelValue !== true) {
        return 0;
      }
      if (fixed.value === true) {
        return revealed.value === true ? size.value : 0;
      }
      const nextOffset = size.value - Math.max(0, $layout.height.value - $layout.scroll.value.position - $layout.containerHeight.value);
      return nextOffset > 0 ? nextOffset : 0;
    });
    const hidden = computed(() => props.modelValue !== true || (fixed.value === true && revealed.value !== true));
    const classes = computed(
      () => `ui-layout__section ui-layout__section--marginal ui-layout__footer${props.bordered === true ? ' border-top' : ''}${hidden.value === true ? ' ui-layout__footer--hidden' : ''}`,
    );
    const style = computed(() => {
      const view = $layout.rows.value.bottom;
      const positioned = fixed.value === true && $layout.isContainer.value !== true ? 'fixed' : 'absolute';
      const css: Record<string, string> = {
        position: positioned,
        bottom: '0',
        left: '0',
        right: '0',
        transform: hidden.value === true ? 'translateY(110%)' : 'translateY(0)',
        transition: 'transform .12s ease, left .12s ease, right .12s ease',
        zIndex: '1001',
      };

      if (view[0] === 'l' && $layout.left.space === true) {
        css[$q.lang.rtl === true ? 'right' : 'left'] = `${$layout.left.size}px`;
      }
      if (view[2] === 'r' && $layout.right.space === true) {
        css[$q.lang.rtl === true ? 'left' : 'right'] = `${$layout.right.size}px`;
      }

      return css;
    });

    watch(
      () => props.modelValue,
      (value) => {
        $layout.update('footer', 'space', value);
        revealed.value = true;
      },
      { immediate: true },
    );
    watch(offset, (value) => $layout.update('footer', 'offset', value), { immediate: true });
    watch($layout.scroll, (scroll) => {
      if (props.reveal === true) {
        revealed.value = scroll.direction === 'up' || scroll.position <= props.revealOffset || scroll.position - scroll.inflectionPoint < 100;
      }
    });
    watch(revealed, (value) => emit('reveal', value));

    $layout.update('footer', 'size', size.value);

    onBeforeUnmount(() => {
      $layout.update('footer', 'size', 0);
      $layout.update('footer', 'offset', 0);
      $layout.update('footer', 'space', false);
    });

    return () => {
      const children = [...(slots.default?.() || [])];

      if (props.elevated === true) {
        children.push(h('div', { class: 'no-pointer-events', style: { position: 'absolute', inset: '0', boxShadow: '0 -4px 10px rgba(0,0,0,.12)' } }));
      }

      children.push(
        h(QResizeObserver, {
          debounce: 0,
          onResize: (data: { height: number }) => {
            size.value = data.height;
            $layout.update('footer', 'size', data.height);
          },
        }),
      );

      return h('div', { class: classes.value, style: style.value }, children);
    };
  },
});

export default UILayoutFooter;
