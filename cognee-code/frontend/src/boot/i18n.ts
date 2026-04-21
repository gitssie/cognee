import { defineBoot } from '#q-app/wrappers';
import { Lang } from 'quasar';
import langEnUS from 'quasar/lang/en-US';
import langZhCN from 'quasar/lang/zh-CN';
import { createI18n } from 'vue-i18n';
import { watch } from 'vue';
import messages, { defaultLocale, isSupportedLocale, type AppLocale } from 'src/i18n';

const LOCALE_STORAGE_KEY = 'app-locale';

const quasarLangMap = {
  'en-US': langEnUS,
  'zh-CN': langZhCN,
} satisfies Record<AppLocale, typeof langEnUS>;

function resolveInitialLocale(): AppLocale {
  const storedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (storedLocale && isSupportedLocale(storedLocale)) {
    return storedLocale;
  }

  const browserLocale = navigator.language;
  if (browserLocale && isSupportedLocale(browserLocale)) {
    return browserLocale;
  }

  if (browserLocale?.startsWith('zh')) {
    return 'zh-CN';
  }

  return defaultLocale;
}

function applyLocale(locale: AppLocale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  Lang.set(quasarLangMap[locale]);
}

export default defineBoot(({ app }) => {
  const locale = resolveInitialLocale();

  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: defaultLocale,
    globalInjection: true,
    messages,
  });

  app.use(i18n);
  applyLocale(locale);

  watch(
    i18n.global.locale,
    (value) => {
      if (isSupportedLocale(value)) {
        applyLocale(value);
      }
    },
    { immediate: true }
  );
});
