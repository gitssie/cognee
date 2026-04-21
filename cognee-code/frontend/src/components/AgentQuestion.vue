<template>
  <div class="agent-question-dock">
    <!-- Header: "1 of N questions" + progress dots -->
    <div class="question-header row items-center no-wrap q-px-sm q-pt-xs">
      <span class="text-caption text-grey-6 col">{{ t('agentQuestion.questionCount', { current: tabIndex + 1, total }) }}</span>
      <div class="row q-gutter-xs">
        <button
          v-for="(_, i) in questions"
          :key="i"
          class="progress-dot"
          :class="{ 'progress-dot--active': i === tabIndex, 'progress-dot--answered': isAnswered(i) }"
          :disabled="sending"
          @click="jump(i)"
        />
      </div>
    </div>

    <q-separator color="grey-3" />

    <!-- Question body -->
    <div class="question-body q-px-sm q-py-xs">
      <div class="text-body2 text-weight-medium q-mb-xs">{{ currentQuestion.question }}</div>
      <div class="text-caption text-grey-5 q-mb-sm">
        {{ currentQuestion.multiple ? t('agentQuestion.selectAll') : t('agentQuestion.selectOne') }}
      </div>

      <!-- Options list -->
      <div class="options-list">
        <button
          v-for="(opt, i) in currentQuestion.options"
          :key="i"
          class="option-btn"
          :class="{ 'option-btn--picked': isOptionPicked(opt.label) }"
          :disabled="sending"
          @click="selectOption(opt.label)"
        >
          <span class="option-check">
            <q-icon
              v-if="currentQuestion.multiple"
              :name="isOptionPicked(opt.label) ? 'check_box' : 'check_box_outline_blank'"
              size="18px"
              :color="isOptionPicked(opt.label) ? 'primary' : 'grey-5'"
            />
            <q-icon
              v-else
              :name="isOptionPicked(opt.label) ? 'radio_button_checked' : 'radio_button_unchecked'"
              size="18px"
              :color="isOptionPicked(opt.label) ? 'primary' : 'grey-5'"
            />
          </span>
          <span class="option-main">
            <span class="option-label">{{ opt.label }}</span>
            <span v-if="opt.description" class="option-description text-caption text-grey-5">{{ opt.description }}</span>
          </span>
        </button>

        <!-- Custom "type your own" option (shown when custom !== false) -->
        <template v-if="currentQuestion.custom !== false">
          <button
            v-if="!editingCustom"
            class="option-btn option-btn--custom"
            :class="{ 'option-btn--picked': customOn }"
            :disabled="sending"
            @click="openCustom"
          >
            <span class="option-check">
              <q-icon
                v-if="currentQuestion.multiple"
                :name="customOn ? 'check_box' : 'check_box_outline_blank'"
                size="18px"
                :color="customOn ? 'primary' : 'grey-5'"
              />
              <q-icon
                v-else
                :name="customOn ? 'radio_button_checked' : 'radio_button_unchecked'"
                size="18px"
                :color="customOn ? 'primary' : 'grey-5'"
              />
            </span>
            <span class="option-main">
              <span class="option-label">{{ t('agentQuestion.typeOwnAnswer') }}</span>
              <span class="option-description text-caption text-grey-5">{{ customText || t('agentQuestion.enterCustomAnswer') }}</span>
            </span>
          </button>

          <div v-else class="option-btn option-btn--custom option-btn--picked option-btn--editing">
            <span class="option-check">
              <q-icon
                v-if="currentQuestion.multiple"
                name="check_box"
                size="18px"
                color="primary"
              />
              <q-icon
                v-else
                name="radio_button_checked"
                size="18px"
                color="primary"
              />
            </span>
            <span class="option-main">
              <span class="option-label">{{ t('agentQuestion.typeOwnAnswer') }}</span>
              <q-input
                v-model="customText"
                autofocus dense borderless
                :placeholder="t('agentQuestion.enterCustomAnswer')"
                class="custom-input"
                @keydown.enter.prevent="commitCustom"
                @keydown.esc.prevent="editingCustom = false"
                @blur="commitCustom"
              />
            </span>
          </div>
        </template>
      </div>
    </div>

    <q-separator color="grey-3" />

    <!-- Footer actions -->
    <div class="question-footer row items-center justify-between q-px-sm q-py-xs">
      <q-btn
        flat no-caps dense
        color="grey-6"
        :label="t('agentQuestion.dismiss')"
        :disable="sending"
        @click="rejectAll"
      />

      <div class="row q-gutter-xs items-center">
        <q-btn
          v-if="tabIndex > 0"
          flat no-caps dense
          color="grey-7"
          :label="t('agentQuestion.back')"
          :disable="sending"
          @click="back"
        />
        <q-btn
          no-caps unelevated
          :color="isLast ? 'primary' : 'grey-3'"
          :text-color="isLast ? 'white' : 'grey-7'"
           :label="isLast ? t('agentQuestion.submit') : t('agentQuestion.next')"
          :loading="sending"
          :disable="sending"
          @click="next"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { QuestionRequest, QuestionAnswer } from '@opencode-ai/sdk/v2';

const props = defineProps<{
  request: QuestionRequest;
  onReply: (requestID: string, answers: QuestionAnswer[]) => Promise<void>;
  onReject: (requestID: string) => Promise<void>;
}>();
const { t } = useI18n();

// ── State ──────────────────────────────────────────────────────────────────────

const tabIndex = ref(0);
const answers = ref<QuestionAnswer[]>([]);
const customTexts = ref<string[]>([]);
const customOns = ref<boolean[]>([]);
const editingCustom = ref(false);
const sending = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────────

const questions = computed(() => props.request.questions);
const total = computed(() => questions.value.length);
const currentQuestion = computed(() => questions.value[tabIndex.value]!);
const isLast = computed(() => tabIndex.value >= total.value - 1);

const customText = computed({
  get: () => customTexts.value[tabIndex.value] ?? '',
  set: (v) => { customTexts.value[tabIndex.value] = v; },
});

const customOn = computed(() => customOns.value[tabIndex.value] === true);

const currentAnswers = computed(() => answers.value[tabIndex.value] ?? []);

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOptionPicked(label: string): boolean {
  return currentAnswers.value.includes(label);
}

function isAnswered(i: number): boolean {
  return (answers.value[i]?.length ?? 0) > 0 ||
    (customOns.value[i] === true && (customTexts.value[i] ?? '').trim().length > 0);
}

function setAnswer(i: number, val: QuestionAnswer) {
  const next = [...answers.value];
  next[i] = val;
  answers.value = next;
}

function selectOption(label: string) {
  if (sending.value) return;
  const q = currentQuestion.value;
  const curr = currentAnswers.value;
  if (q.multiple) {
    const next = curr.includes(label) ? curr.filter((a: string) => a !== label) : [...curr, label];
    setAnswer(tabIndex.value, next);
  } else {
    setAnswer(tabIndex.value, [label]);
    // Clear custom if a preset option is chosen
    customOns.value[tabIndex.value] = false;
    editingCustom.value = false;
  }
}

function openCustom() {
  if (sending.value) return;
  editingCustom.value = true;
  customOns.value[tabIndex.value] = true;
  syncCustomToAnswers();
}

function syncCustomToAnswers() {
  const text = (customTexts.value[tabIndex.value] ?? '').trim();
  const q = currentQuestion.value;
  const curr = currentAnswers.value;
  if (q.multiple) {
    const withoutOld = curr.filter((a: string) => !a.startsWith('__custom__'));
    setAnswer(tabIndex.value, text ? [...withoutOld, text] : withoutOld);
  } else {
    setAnswer(tabIndex.value, text ? [text] : []);
  }
}

function commitCustom() {
  editingCustom.value = false;
  syncCustomToAnswers();
}

function jump(i: number) {
  if (sending.value) return;
  if (editingCustom.value) commitCustom();
  tabIndex.value = i;
  editingCustom.value = false;
}

function back() {
  if (sending.value) return;
  if (editingCustom.value) commitCustom();
  if (tabIndex.value > 0) {
    tabIndex.value--;
    editingCustom.value = false;
  }
}

function next() {
  if (sending.value) return;
  if (editingCustom.value) commitCustom();
  if (!isLast.value) {
    tabIndex.value++;
    editingCustom.value = false;
    return;
  }
  submit();
}

function submit() {
  const finalAnswers = questions.value.map((_q: QuestionRequest['questions'][number], i: number) => answers.value[i] ?? []);
  void doReply(finalAnswers);
}

async function doReply(finalAnswers: QuestionAnswer[]) {
  sending.value = true;
  try {
    await props.onReply(props.request.id, finalAnswers);
  } finally {
    sending.value = false;
  }
}

async function rejectAll() {
  sending.value = true;
  try {
    await props.onReject(props.request.id);
  } finally {
    sending.value = false;
  }
}
</script>

<style lang="scss" scoped>
.agent-question-dock {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 8px;
  background: white;
  border: 1px solid $grey-3;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.question-header {
  min-height: 28px;
}

.progress-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: none;
  background: $grey-4;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s, transform 0.15s;

  &--active {
    background: $primary;
    transform: scale(1.25);
  }

  &--answered {
    background: $positive;
  }

  &:disabled {
    cursor: default;
    opacity: 0.6;
  }
}

.question-body {
  max-height: 220px;
  overflow-y: auto;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.option-btn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid $grey-3;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;

  &:hover:not(:disabled) {
    border-color: $primary;
    background: rgba($primary, 0.04);
  }

  &--picked {
    border-color: $primary;
    background: rgba($primary, 0.06);
  }

  &--editing {
    cursor: default;
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
}

.option-check {
  flex-shrink: 0;
  margin-top: 1px;
}

.option-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.option-label {
  font-size: 12px;
  font-weight: 500;
  color: $dark;
  line-height: 1.3;
}

.option-description {
  font-size: 11px;
  line-height: 1.3;
}

.custom-input {
  width: 100%;
  margin-top: 2px;
}

.question-footer {
  min-height: 36px;
}
</style>
