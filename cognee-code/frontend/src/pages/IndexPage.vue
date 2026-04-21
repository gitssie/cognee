<template>
  <q-page class="q-pa-lg">
    <div class="row q-col-gutter-lg">
      <div class="col-12 q-mb-md">
        <div class="text-h4 text-weight-bold q-mb-sm text-dark">{{ t('index.title') }}</div>
        <div class="text-subtitle1 text-grey-7">
          {{ t('index.subtitle') }}
        </div>
      </div>

      <!-- Knowledge Base Card -->
      <div class="col-12 col-md-4">
        <q-card class="my-card cursor-pointer hover:border-primary" @click="$router.push('/knowledge')">
          <q-card-section class="q-pa-lg">
            <div class="row items-center no-wrap">
              <div class="col-auto">
                <q-avatar color="primary" text-color="white" icon="library_books" font-size="24px" />
              </div>
              <div class="col q-pl-md">
                <div class="text-h6 text-weight-bold text-dark">{{ t('layout.knowledgeBase') }}</div>
                <div class="text-caption text-grey-6">M1 {{ t('index.module') }}</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              {{ t('index.knowledgeDescription') }}
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="primary" :label="t('index.manageDatasets')" icon-right="arrow_forward" class="full-width text-weight-bold" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Graph View Card -->
      <div class="col-12 col-md-4">
        <q-card class="my-card cursor-pointer" @click="$router.push('/graph')">
          <q-card-section class="q-pa-lg">
            <div class="row items-center no-wrap">
              <div class="col-auto">
                <q-avatar color="secondary" text-color="white" icon="hub" font-size="24px" />
              </div>
              <div class="col q-pl-md">
                <div class="text-h6 text-weight-bold text-dark">{{ t('index.graphView') }}</div>
                <div class="text-caption text-grey-6">M2 {{ t('index.module') }}</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              {{ t('index.graphDescription') }}
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="secondary" :label="t('index.viewGraph')" icon-right="arrow_forward" class="full-width text-weight-bold" />
          </q-card-actions>
        </q-card>
      </div>

      <!-- Agents -->
      <div class="col-12 col-md-4">
        <q-card class="my-card cursor-pointer" @click="$router.push('/agents')">
          <q-card-section class="q-pa-lg">
            <div class="row items-center no-wrap">
              <div class="col-auto">
                <q-avatar color="accent" text-color="white" icon="smart_toy" font-size="24px" />
              </div>
              <div class="col q-pl-md">
                <div class="text-h6 text-weight-bold text-dark">{{ t('layout.agents') }}</div>
                <div class="text-caption text-grey-6">M4 {{ t('index.module') }}</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              {{ t('index.agentsDescription') }}
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="accent" :label="t('index.startChat')" icon-right="arrow_forward" class="full-width text-weight-bold" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
</script>

<style lang="scss" scoped>
.my-card {
  height: 100%;
  transition: all 0.3s ease;
  border-radius: 12px;
  
  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05) !important;
    border-color: var(--q-primary);
  }
}

.disabled-card {
  opacity: 0.7;
  background: #f8fafc;
  &:hover {
    transform: none;
    box-shadow: none !important;
    border-color: #e2e8f0;
  }
}

.text-dark {
  color: #1e293b;
}

.leading-relaxed {
  line-height: 1.625;
}
</style>
