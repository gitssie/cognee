<template>
  <q-layout view="lHh Lpr lFf">
    <!-- Header: Clean White -->
    <q-header class="bg-white text-dark bordered-bottom" height-hint="64">
      <q-toolbar class="h-16">
        <q-btn
          flat
          dense
          round
          icon="menu"
          :aria-label="t('layout.dashboard')"
          @click="toggleLeftDrawer"
          class="text-grey-7"
        />

        <q-toolbar-title class="text-weight-bold flex items-center text-slate-900">
          <q-icon name="memory" class="q-mr-sm text-primary" size="28px" />
          <span>Cognee</span> <span class="text-weight-light">Code</span>
        </q-toolbar-title>

        <div class="row items-center q-gutter-sm">
          <q-select
            v-model="locale"
            :options="languageOptions"
            dense
            borderless
            emit-value
            map-options
            options-dense
            style="min-width: 110px"
            class="text-grey-7"
          />
          <div class="text-caption text-grey-6">v0.0.1</div>
          <q-btn round flat icon="notifications" color="grey-6" size="sm" />
          <q-avatar size="32px" color="primary" text-color="white" class="shadow-1">
            <span class="text-weight-bold">A</span>
          </q-avatar>
        </div>
      </q-toolbar>
    </q-header>

    <!-- Sidebar: Deep Slate -->
    <q-drawer v-model="leftDrawerOpen" show-if-above class="bg-secondary text-grey-4" :width="260">
      <q-list padding class="q-pt-lg">
        <q-item-label
          header
          class="text-grey-6 text-uppercase text-weight-bold q-pl-md font-xs q-mb-sm"
        >
          {{ t('layout.platform') }}
        </q-item-label>

        <q-item
          to="/"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          exact
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="dashboard" />
          </q-item-section>
          <q-item-section>{{ t('layout.dashboard') }}</q-item-section>
        </q-item>

        <q-item
          to="/search"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="search" />
          </q-item-section>
          <q-item-section>{{ t('layout.search') }}</q-item-section>
        </q-item>

        <q-item
          to="/knowledge"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="library_books" />
          </q-item-section>
          <q-item-section>{{ t('layout.knowledgeBase') }}</q-item-section>
        </q-item>

        <q-item
          to="/graph"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="hub" />
          </q-item-section>
          <q-item-section>{{ t('layout.graphKnowledge') }}</q-item-section>
          <q-item-section side>
            <q-badge color="grey-8" label="M2" outline />
          </q-item-section>
        </q-item>

        <q-item
          to="/agents"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="smart_toy" />
          </q-item-section>
          <q-item-section>{{ t('layout.agents') }}</q-item-section>
          <q-item-section side>
            <q-badge color="grey-8" label="M4" outline />
          </q-item-section>
        </q-item>

        <q-separator class="q-my-md bg-grey-8" />

        <q-item-label
          header
          class="text-grey-6 text-uppercase text-weight-bold q-pl-md font-xs q-mb-sm"
        >
          {{ t('layout.system') }}
        </q-item-label>

        <q-item
          to="/settings"
          active-class="bg-primary text-white shadow-md"
          clickable
          v-ripple
          class="q-my-xs q-mx-sm rounded-borders transition-colors"
        >
          <q-item-section avatar>
            <q-icon name="settings" />
          </q-item-section>
          <q-item-section>{{ t('layout.settings') }}</q-item-section>
        </q-item>
      </q-list>
    </q-drawer>

    <q-page-container class="bg-app">
      <router-view />
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { localeOptions } from 'src/i18n';

const leftDrawerOpen = ref(false);
const { t, locale } = useI18n({ useScope: 'global' });

const languageOptions = localeOptions;

function toggleLeftDrawer() {
  leftDrawerOpen.value = !leftDrawerOpen.value;
}
</script>

<style lang="scss" scoped>
.bordered-bottom {
  border-bottom: 1px solid #e2e8f0;
}
.rounded-borders {
  border-radius: 8px;
}
.opacity-50 {
  opacity: 0.5;
}
.font-xs {
  font-size: 0.7rem;
  letter-spacing: 0.08em;
}
.text-slate-900 {
  color: #0f172a;
}
.bg-app {
  background-color: #f8fafc;
}
.shadow-md {
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -1px rgba(0, 0, 0, 0.06);
}
</style>
