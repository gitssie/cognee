# Frontend Agent Guidelines (cognee-code/frontend)

This document defines the protocols, conventions, and workflows for AI agents working within the `cognee-code/frontend/` directory.

## 1. Project Overview

- **Framework:** [Quasar Framework](https://quasar.dev/) (v2) based on [Vue.js 3](https://vuejs.org/).
- **Language:** TypeScript.
- **Build Tool:** Vite (via `@quasar/app-vite`).
- **Styling:** SCSS + Quasar Utility Classes.
- **State Management:** *[Check if Pinia/Vuex is installed before usage - currently not in package.json]*.
- **Routing:** Vue Router.

## 2. Environment & Commands

Always use **Yarn** for package management in this directory.

| Action | Command | Description |
| :--- | :--- | :--- |
| **Install** | `yarn install` | Install dependencies. |
| **Dev Server** | `yarn dev` | Start the development server (HMR enabled). |
| **Build** | `yarn build` | Build the application for production. |
| **Lint** | `yarn lint` | Run ESLint to check code quality. |
| **Type Check** | `yarn run vue-tsc --noEmit` | Run TypeScript type checking. |
| **Format** | `yarn format` | Run Prettier to format code. |

## 3. Vue 3 Best Practices

### 3.1 Script Setup & Composition API
- **Standard:** Always use `<script setup lang="ts">`.
- **Reactivity:**
  - Prefer `ref` for primitives and simple objects.
  - Use `reactive` only for complex, grouped state where appropriate.
  - Always type your refs: `const list = ref<MyType[]>([])`.
- **Props & Emits:**
  - Use `defineProps<{ ... }>()` for type-safe props.
  - Use `defineEmits<{ ... }>()` for type-safe events.

```typescript
<script setup lang="ts">
interface Props {
  title: string;
  count?: number;
}
const props = withDefaults(defineProps<Props>(), {
  count: 0
});

const emit = defineEmits<{
  (e: 'update', value: number): void;
}>();
</script>
```

### 3.2 Component Structure
Follow this order in `.vue` files:
1. `<template>`
2. `<script setup lang="ts">`
3. `<style lang="scss" scoped>`

## 4. Quasar Styling & CSS/SCSS

Quasar provides a comprehensive set of CSS utility classes. **Prioritize using these utilities over writing custom SCSS.**

### 4.1 Layout & Grid (Flexbox)
- **Rows:** Use `.row` to create a flex container.
- **Columns:** Use `.col`, `.col-auto`, `.col-{breakpoint}-{width}` (e.g., `col-12`, `col-md-6`).
- **Gutters:** Use `.q-col-gutter-{size}` on the parent `.row` (e.g., `q-col-gutter-md`).

```html
<div class="row q-col-gutter-md">
  <div class="col-12 col-md-6">...</div>
  <div class="col-12 col-md-6">...</div>
</div>
```

### 4.2 Spacing (Margins & Paddings)
Format: `q-{type}{direction}-{size}`
- **Type:** `m` (margin), `p` (padding).
- **Direction:** `a` (all), `x` (horizontal), `y` (vertical), `t` (top), `r` (right), `b` (bottom), `l` (left).
- **Size:** `none`, `xs`, `sm`, `md`, `lg`, `xl`.
- **Examples:** `q-pa-md` (padding all medium), `q-mt-lg` (margin top large), `q-my-none` (no vertical margin).

### 4.3 Typography & Colors
- **Text Classes:** `text-h1` to `text-h6`, `text-subtitle1`, `text-body1`, `text-caption`.
- **Weights:** `text-weight-bold`, `text-weight-medium`, `text-weight-regular`.
- **Align:** `text-center`, `text-right`.
- **Colors:** Use project palette variables as classes: `text-primary`, `bg-secondary`, `bg-grey-2`.

### 4.4 Flex Utilities
- `flex-center` (quick center everything), `items-center` (vertical align), `justify-between` (space between).

### 4.5 SCSS Best Practices
- **Scoped:** Always use `scoped` styles unless modifying global Quasar overrides.
- **Variables:** Access Quasar variables defined in `src/css/quasar.variables.scss` automatically.
- **Variables List:**
  - `$primary` (#1976d2), `$secondary` (#26a69a), `$accent` (#9c27b0)
  - `$positive`, `$negative`, `$info`, `$warning`
  - `$dark`, `$dark-page`
- **Nesting:** Use SCSS nesting carefully. Avoid deep nesting (>3 levels).

```scss
<style lang="scss" scoped>
.my-card {
  // Use Quasar variables directly
  border: 1px solid $primary;
  
  // Use & for parent selector
  &:hover {
    background-color: $grey-2;
  }
}
</style>
```

## 5. UI Component Guidelines

- **Buttons:** Use `<q-btn>` with proper props (`flat`, `unelevated`, `outline`) rather than standard buttons.
- **Inputs:** Use `<q-input>` with `v-model`. Use `outlined` or `filled` styles consistently across forms.
- **Icons:** Use the `icon` prop with Material Icons names (e.g., `icon="search"`).
- **Lists:** Use `<q-list>`, `<q-item>`, `<q-item-section>` for structured lists.

## 6. Directory Structure & Roles

- `src/pages/`: **Views**. Should handle route-specific logic and data fetching.
- `src/components/`: **Dumb Components**. Should accept props and emit events. Avoid heavy business logic here.
- `src/layouts/`: **Shells**. `MainLayout.vue` usually defines the `q-layout`, `q-header`, `q-drawer`.
- `src/router/routes.ts`: **Route Definitions**. Define paths and lazy-load components.
- `src/boot/`: **Initialization**. Use for global plugins (e.g., Axios interceptors, i18n).

## 7. Agent Workflow

1.  **Analyze Context:** Before editing, read `src/router/routes.ts` to understand the app structure.
2.  **Lint First:** Ensure `eslint.config.js` rules are respected.
3.  **Use Utilities:** When asked to style something, look for a Quasar utility class *first* before writing CSS.
4.  **Verify:** After changes, ensure `yarn lint` and `yarn run vue-tsc --noEmit` pass.
