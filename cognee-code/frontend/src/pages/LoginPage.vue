<template>
  <q-page class="flex flex-center bg-grey-2">
    <q-card class="q-pa-lg" style="width: 400px; max-width: 90vw;">
      <q-card-section class="text-center">
        <div class="text-h4 text-primary q-mb-sm">Cognee-Code</div>
        <div class="text-subtitle1 text-grey">{{ isLogin ? 'Sign In' : 'Create Account' }}</div>
      </q-card-section>

      <q-card-section>
        <q-form @submit.prevent="handleSubmit" class="q-gutter-md">
          <q-input
            v-model="email"
            label="Email"
            type="email"
            outlined
            :rules="[val => !!val || 'Email is required', val => /.+@.+\..+/.test(val) || 'Invalid email']"
          />

          <q-input
            v-model="password"
            label="Password"
            :type="showPassword ? 'text' : 'password'"
            outlined
            :rules="[val => !!val || 'Password is required', val => val.length >= 6 || 'Min 6 characters']"
          >
            <template v-slot:append>
              <q-icon
                :name="showPassword ? 'visibility_off' : 'visibility'"
                class="cursor-pointer"
                @click="showPassword = !showPassword"
              />
            </template>
          </q-input>

          <q-input
            v-if="!isLogin"
            v-model="confirmPassword"
            label="Confirm Password"
            :type="showPassword ? 'text' : 'password'"
            outlined
            :rules="[val => val === password || 'Passwords do not match']"
          />

          <q-btn
            type="submit"
            color="primary"
            class="full-width"
            size="lg"
            :label="isLogin ? 'Sign In' : 'Create Account'"
            :loading="loading"
          />
        </q-form>
      </q-card-section>

      <q-card-section class="text-center q-pt-none">
        <q-btn
          flat
          color="primary"
          :label="isLogin ? 'Need an account? Register' : 'Already have an account? Sign In'"
          @click="isLogin = !isLogin"
        />
      </q-card-section>

      <q-card-section v-if="isLogin" class="text-center q-pt-none">
        <q-btn flat color="grey" label="Forgot Password?" @click="showForgotPassword = true" size="sm" />
      </q-card-section>
    </q-card>

    <!-- Forgot Password Dialog -->
    <q-dialog v-model="showForgotPassword">
      <q-card style="min-width: 350px">
        <q-card-section>
          <div class="text-h6">Reset Password</div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-input v-model="resetEmail" label="Email" type="email" outlined />
        </q-card-section>

        <q-card-actions align="right">
          <q-btn flat label="Cancel" v-close-popup />
          <q-btn color="primary" label="Send Reset Link" @click="handleForgotPassword" :loading="resetLoading" />
        </q-card-actions>
      </q-card>
    </q-dialog>
  </q-page>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useQuasar } from 'quasar';
import { AuthService } from 'src/services/auth';

const router = useRouter();
const $q = useQuasar();

const isLogin = ref(true);
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const loading = ref(false);

const showForgotPassword = ref(false);
const resetEmail = ref('');
const resetLoading = ref(false);

async function handleSubmit() {
  loading.value = true;
  try {
    if (isLogin.value) {
      await AuthService.login({ username: email.value, password: password.value });
      $q.notify({ color: 'positive', message: 'Login successful' });
      void router.push('/');
    } else {
      await AuthService.register({ email: email.value, password: password.value });
      $q.notify({ color: 'positive', message: 'Account created! Please sign in.' });
      isLogin.value = true;
      password.value = '';
      confirmPassword.value = '';
    }
  } catch (err) {
    const message = isLogin.value ? 'Login failed. Check your credentials.' : 'Registration failed.';
    $q.notify({ color: 'negative', message });
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function handleForgotPassword() {
  if (!resetEmail.value) return;
  resetLoading.value = true;
  try {
    await AuthService.forgotPassword(resetEmail.value);
    $q.notify({ color: 'positive', message: 'Reset link sent to your email' });
    showForgotPassword.value = false;
    resetEmail.value = '';
  } catch {
    $q.notify({ color: 'negative', message: 'Failed to send reset link' });
  } finally {
    resetLoading.value = false;
  }
}
</script>
