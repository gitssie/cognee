/**
 * Quasar boot file: sse
 *
 * Creates a Quasar EventBus, provides it app-wide via Vue's provide/inject,
 * and opens the single global SSE connection to GET /api/v1/events on startup.
 *
 * Components subscribe to events via:
 *   const bus = inject<EventBus>('sseBus')!
 *   bus.on('pipeline:update', handler)
 *   // on unmount: bus.off('pipeline:update', handler)
 */

import { defineBoot } from '#q-app/wrappers';
import { EventBus } from 'quasar';
import { initSseService, destroySseService } from 'src/services/sse';
import { AuthService } from 'src/services/auth';

export default defineBoot(async ({ app }) => {
  const bus = new EventBus();
  app.provide('sseBus', bus);

  let sseStarted = false;

  function startSse() {
    if (sseStarted) return;
    sseStarted = true;
    initSseService(bus);
  }

  // 已登录 → 直接启动
  try {
    await AuthService.getCurrentUser();
    startSse();
  } catch { /* 未登录，等 auth:login 事件 */ }

  // 登录成功后由 LoginPage 触发
  bus.on('auth:login', startSse);

  // 登出时关闭
  bus.on('auth:logout', () => {
    sseStarted = false;
    destroySseService();
  });

  app.unmount = (() => {
    const originalUnmount = app.unmount.bind(app);
    return () => {
      destroySseService();
      originalUnmount();
    };
  })();
});
