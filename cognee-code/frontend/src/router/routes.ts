import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    component: () => import('pages/LoginPage.vue'),
  },
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: () => import('pages/IndexPage.vue') },
      { path: 'knowledge', component: () => import('pages/KnowledgePage.vue') },
      { path: 'graph', component: () => import('pages/GraphKnowledgePage.vue') },
      { path: 'rules', component: () => import('pages/CodeRulesPage.vue') },
      { path: 'notebooks', component: () => import('pages/NotebookPage.vue') },
      { path: 'agents', component: () => import('pages/AgentPage.vue') },
      { path: 'search', component: () => import('pages/SearchPage.vue') },
      { path: 'admin', component: () => import('pages/AdminPage.vue') },
      { path: 'settings', component: () => import('pages/SettingsPage.vue') }
    ],
  },

  // Always leave this as last one,
  // but you can also remove it
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
];

export default routes;
