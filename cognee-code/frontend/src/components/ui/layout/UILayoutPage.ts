import { useQuasar } from 'quasar';
import { computed, defineComponent, h, inject } from 'vue';
import { uiLayoutKey, uiPageContainerKey, type UILayoutContext } from './context';

export const UILayoutPage = defineComponent({
  name: 'UILayoutPage',
  props: {
    padding: {
      type: Boolean,
      default: false,
    },
    styleFn: {
      type: Function,
      default: undefined,
    },
  },
  setup(props, { slots }) {
    const $q = useQuasar();
    const $layout = inject<UILayoutContext | undefined>(uiLayoutKey, undefined);
    const hasPageContainer = inject(uiPageContainerKey, false);

    if (!$layout) {
      console.error('UILayoutPage needs to be a deep child of UILayout');
      return () => null;
    }
    if (hasPageContainer !== true) {
      console.error('UILayoutPage needs to be child of UILayoutPageContainer');
      return () => null;
    }

    const style = computed(() => {
      const offset = ($layout.header.space === true ? $layout.header.size : 0) + ($layout.footer.space === true ? $layout.footer.size : 0);

      if (typeof props.styleFn === 'function') {
        const height = $layout.isContainer.value === true ? $layout.containerHeight.value : $q.screen.height;
        return props.styleFn(offset, height);
      }

      const pageHeight = $layout.isContainer.value === true ? Math.max(0, $layout.containerHeight.value - offset) : Math.max(0, ($q.screen.height || $layout.height.value) - offset);

      return {
        minHeight: `${pageHeight}px`,
        height: `${pageHeight}px`,
        display: 'flex',
        flexDirection: 'column',
      };
    });

    const classes = computed(() => `ui-layout__page relative${props.padding === true ? ' q-layout-padding' : ''}`);

    return () => h('div', { class: classes.value, style: style.value }, slots.default?.() || []);
  },
});

export default UILayoutPage;
