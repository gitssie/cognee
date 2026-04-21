import { useQuasar } from 'quasar';
import { computed, defineComponent, h, inject, provide } from 'vue';
import { uiLayoutKey, uiPageContainerKey, type UILayoutContext } from './context';

export const UILayoutPageContainer = defineComponent({
  name: 'UILayoutPageContainer',
  setup(_, { slots }) {
    const $q = useQuasar();
    const $layout = inject<UILayoutContext | undefined>(uiLayoutKey, undefined);

    if (!$layout) {
      console.error('UILayoutPageContainer needs to be child of UILayout');
      return () => null;
    }

    provide(uiPageContainerKey, true);

    const style = computed(() => {
      const css: Record<string, string> = {};

      if ($layout.header.space === true) {
        css.paddingTop = `${$layout.header.size}px`;
      }
      if ($layout.right.space === true) {
        css[`padding${$q.lang.rtl === true ? 'Left' : 'Right'}`] = `${$layout.right.size}px`;
      }
      if ($layout.footer.space === true) {
        css.paddingBottom = `${$layout.footer.size}px`;
      }
      if ($layout.left.space === true) {
        css[`padding${$q.lang.rtl === true ? 'Right' : 'Left'}`] = `${$layout.left.size}px`;
      }

      return {
        ...css,
        height: '100%',
        minHeight: '0',
      };
    });

    return () =>
      h(
        'div',
        {
          class: 'ui-layout__page-container',
          style: style.value,
        },
        slots.default?.() || [],
      );
  },
});

export default UILayoutPageContainer;
