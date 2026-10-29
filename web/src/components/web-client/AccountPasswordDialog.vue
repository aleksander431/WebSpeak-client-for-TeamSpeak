<template>
  <div
    class="modal-backdrop channel-password-backdrop"
    data-ws-part="auth.password.backdrop"
    :data-ws-state="`account-${mode}`"
    @click.self="emit('cancel')"
  >
    <section
      ref="dialog"
      class="channel-password-modal server-password-modal account-password-modal"
      data-ws-part="auth.password.dialog"
      :data-ws-state="`account-${mode}`"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-password-title"
      @keydown="onDialogKeydown"
      @click.stop
    >
      <button
        type="button"
        class="qq-modal-close"
        :aria-label="t('close')"
        :title="t('close')"
        @click="emit('cancel')"
        ><Icon
          name="close"
          :size="19"
      /></button>
      <div
        class="channel-password-icon"
        data-ws-part="auth.password.decoration"
        ><Icon
          name="lock"
          :size="22"
      /></div>
      <span
        class="card-kicker"
        data-ws-part="auth.password.eyebrow"
        >{{ nickname }}</span>
      <h2
        id="account-password-title"
        data-ws-part="auth.password.title"
        >{{ t(mode === "create" ? "accountCreateTitle" : "accountSignInTitle") }}</h2>
      <p data-ws-part="auth.password.lead">{{ t(mode === "create" ? "accountCreateLead" : "accountSignInLead") }}</p>
      <form
        class="channel-password-form"
        data-ws-part="auth.password.form"
        @submit.prevent="submit"
      >
        <label
          class="field-label"
          data-ws-part="auth.password.label"
          for="account-password-input"
          >{{ t("accountPasswordLabel") }}</label>
        <div
          class="field-wrap"
          data-ws-part="auth.password.field"
          ><Icon
            name="lock"
            data-ws-part="auth.password.field-icon"
            :size="17" /><input
            id="account-password-input"
            v-model="password"
            type="password"
            :autocomplete="mode === 'create' ? 'new-password' : 'current-password'"
            :minlength="mode === 'create' ? minLength : undefined"
            maxlength="128"
            :disabled="busy"
            autofocus
        /></div>
        <template v-if="mode === 'create'">
          <label
            class="field-label"
            data-ws-part="auth.password.label"
            for="account-password-confirm"
            >{{ t("accountPasswordConfirmLabel") }}</label>
          <div
            class="field-wrap"
            data-ws-part="auth.password.field"
            ><Icon
              name="lock"
              data-ws-part="auth.password.field-icon"
              :size="17" /><input
              id="account-password-confirm"
              v-model="confirmation"
              type="password"
              autocomplete="new-password"
              maxlength="128"
              :disabled="busy"
          /></div>
        </template>
        <p
          v-if="shownError"
          class="account-password-error"
          role="alert"
          >{{ shownError }}</p>
        <div
          class="channel-password-actions"
          data-ws-part="auth.password.actions"
          ><button
            type="button"
            class="text-button"
            :disabled="busy"
            @click="emit('cancel')"
            >{{ t(mode === "create" ? "accountCreateLater" : "channelPasswordCancel") }}</button
          ><button
            type="submit"
            class="primary-button channel-password-submit"
            :disabled="busy || !password"
            ><span>{{ t(mode === "create" ? "accountCreateSubmit" : "accountSignInSubmit") }}</span
            ><Icon
              name="chevron-right"
              :size="17" /></button
        ></div>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Icon from "../Icon.vue";
import { useDialogFocus } from "../../composables/useDialogFocus.js";

const props = defineProps<{
  mode: "create" | "sign-in";
  nickname: string;
  busy: boolean;
  /** Server error code from the last attempt, if any. */
  errorCode: string;
  minLength: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}>();
const emit = defineEmits<{ cancel: []; submit: [password: string] }>();
const password = ref("");
const confirmation = ref("");
const localError = ref("");
const dialog = ref<HTMLElement | null>(null);
const { onDialogKeydown } = useDialogFocus(dialog, () => emit("cancel"),
  () => document.querySelector<HTMLElement>('[data-ws-part="home.connect"]'));

const errorKeys: Record<string, string> = {
  ACCOUNT_PASSWORD_INVALID: "accountPasswordInvalid",
  ACCOUNT_LOCKED: "accountLocked",
  ACCOUNT_PASSWORD_TOO_SHORT: "accountPasswordTooShort",
  ACCOUNT_PASSWORD_TOO_LONG: "accountPasswordTooShort",
  ACCOUNT_EXISTS: "accountExists",
  APPROVAL_DENIED: "approvalDeniedText",
  RATE_LIMITED: "accountRateLimited",
};
const shownError = computed(() => localError.value
  || (props.errorCode ? props.t(errorKeys[props.errorCode] ?? "accountRequestFailed", { min: props.minLength }) : ""));

// A new server answer replaces any local validation message.
watch(() => props.errorCode, () => { localError.value = ""; });

function submit() {
  if (props.busy) return;
  localError.value = "";
  if (props.mode === "create") {
    if (password.value.length < props.minLength) { localError.value = props.t("accountPasswordTooShort", { min: props.minLength }); return; }
    if (password.value !== confirmation.value) { localError.value = props.t("accountPasswordMismatch"); return; }
  }
  emit("submit", password.value);
}
</script>
