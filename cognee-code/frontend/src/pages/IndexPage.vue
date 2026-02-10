<template>
  <q-page class="q-pa-lg">
    <div class="row q-col-gutter-lg">
      <div class="col-12 q-mb-md">
        <div class="text-h4 text-weight-bold q-mb-sm text-dark">Welcome to Cognee Code</div>
        <div class="text-subtitle1 text-grey-7">
          AI-Assisted Development Platform powered by Knowledge Graphs.
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
                <div class="text-h6 text-weight-bold text-dark">Knowledge Base</div>
                <div class="text-caption text-grey-6">M1 Module</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              Upload documents, manage datasets, and prepare your knowledge base for the AI.
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="primary" label="Manage Datasets" icon-right="arrow_forward" class="full-width text-weight-bold" />
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
                <div class="text-h6 text-weight-bold text-dark">Graph View</div>
                <div class="text-caption text-grey-6">M2 Module</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              Visualize connections between code and docs in an interactive knowledge graph.
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="secondary" label="View Graph" icon-right="arrow_forward" class="full-width text-weight-bold" />
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
                <div class="text-h6 text-weight-bold text-dark">AI Agents</div>
                <div class="text-caption text-grey-6">M4 Module</div>
              </div>
            </div>
            
            <div class="q-mt-md text-grey-8 leading-relaxed">
              Chat with AI agents powered by your knowledge base.
            </div>
          </q-card-section>

          <q-separator color="grey-2" />

          <q-card-actions class="q-pa-md">
            <q-btn flat color="accent" label="Start Chat" icon-right="arrow_forward" class="full-width text-weight-bold" />
          </q-card-actions>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
// Logic can be added here
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
