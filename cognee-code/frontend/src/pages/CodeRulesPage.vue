<template>
  <q-page class="q-pa-md">
    <div class="text-h4 q-mb-md">Code Rules</div>

    <q-card>
      <q-card-section>
        <div class="text-h5">Coding Agent Rules</div>
        <div class="text-subtitle2 text-grey">Best practices and memory (M3)</div>
      </q-card-section>
      <q-separator />
      <q-card-section>
        <RuleManager />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import RuleManager from 'components/RuleManager.vue';

defineOptions({
  name: 'CodeRulesPage'
});
</script>
