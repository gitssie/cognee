import enUS from './en-US';
import zhCN from './zh-CN';

export const localeOptions = [
  { value: 'en-US', label: 'English' },
  { value: 'zh-CN', label: '中文' },
] as const;

export const defaultLocale = 'zh-CN';

const messages = {
  'en-US': enUS,
  'zh-CN': zhCN,
};

export type AppLocale = keyof typeof messages;

export function isSupportedLocale(locale: string): locale is AppLocale {
  return locale in messages;
}

export default messages;
