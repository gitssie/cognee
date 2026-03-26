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

export default defineBoot(({ app }) => {
  const bus = new EventBus();

  // Make the bus injectable in all components
  app.provide('sseBus', bus);

  // Open the global SSE connection — forwards all server events onto the bus
  initSseService(bus);

  // Clean up on app unmount (relevant mainly for SSR / hot-reload)
  app.unmount = (() => {
    const originalUnmount = app.unmount.bind(app);
    return () => {
      destroySseService();
      originalUnmount();
    };
  })();
});
