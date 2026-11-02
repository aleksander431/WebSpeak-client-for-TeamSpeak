import { onScopeDispose, reactive, ref, type Ref } from "vue";
import type { copy } from "../i18n/admin.js";
import { isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";
import { GIB, MIB, type ChatStorageSettings, type ChatStorageUsage } from "../../../src/shared/chat-storage.js";

interface Options {
  api: AdminApi;
  errorMessage: Ref<string>;
  errorText(code?: string): string;
  tr(key: keyof typeof copy.zh, vars?: Record<string, string | number>): string;
}

/** Form values in the units the administrator types (MB and GB). */
export interface ChatStorageForm {
  maxFileMb: number;
  quotaGb: number;
  historyEnabled: boolean;
}

const roundTo = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Chat attachment and history storage settings for the admin console. */
export function useAdminChatStorage(options: Options) {
  const requests = createAdminRequests();
  const loading = ref(false);
  const saving = ref(false);
  const clearing = ref(false);
  const clearArmed = ref(false);
  const notice = ref("");
  const loaded = ref(false);
  const form = reactive<ChatStorageForm>({ maxFileMb: 25, quotaGb: 5, historyEnabled: true });
  const usage = reactive<ChatStorageUsage>({ usedBytes: 0, fileBytes: 0, fileCount: 0, messageBytes: 0, messageCount: 0 });
  const saved = reactive<ChatStorageSettings>({ maxFileBytes: 25 * MIB, quotaBytes: 5 * GIB, historyEnabled: true });
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function apply(result: { settings: ChatStorageSettings; usage: ChatStorageUsage }): void {
    Object.assign(saved, result.settings);
    Object.assign(usage, result.usage);
    form.maxFileMb = roundTo(result.settings.maxFileBytes / MIB, 2);
    form.quotaGb = roundTo(result.settings.quotaBytes / GIB, 3);
    form.historyEnabled = result.settings.historyEnabled;
    loaded.value = true;
  }
  function report(error: unknown): void {
    if (!isAdminRequestCancelled(error)) options.errorMessage.value = options.errorText((error as { code?: string }).code);
  }

  async function load(): Promise<void> {
    const request = requests.begin("load");
    loading.value = true;
    try {
      const result = await options.api.chatStorage(request.signal);
      if (request.isCurrent()) apply(result);
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) loading.value = false; request.finish(); }
  }

  async function save(): Promise<void> {
    if (saving.value) return;
    const maxFileBytes = Math.round(Number(form.maxFileMb) * MIB);
    const quotaBytes = Math.round(Number(form.quotaGb) * GIB);
    if (!Number.isFinite(maxFileBytes) || !Number.isFinite(quotaBytes) || maxFileBytes < 0 || quotaBytes < 0) {
      options.errorMessage.value = options.tr("chatStorageInvalid");
      return;
    }
    const request = requests.begin("save");
    saving.value = true; notice.value = ""; options.errorMessage.value = "";
    try {
      const result = await options.api.saveChatStorage({ maxFileBytes, quotaBytes, historyEnabled: form.historyEnabled }, request.signal);
      if (request.isCurrent()) { apply(result); notice.value = options.tr("chatStorageSaved"); }
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) saving.value = false; request.finish(); }
  }

  /** The first click arms, the second (within a few seconds) deletes. */
  async function clear(): Promise<void> {
    if (clearing.value) return;
    if (!clearArmed.value) {
      clearArmed.value = true;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { clearArmed.value = false; }, 4000);
      return;
    }
    clearTimeout(armTimer);
    clearArmed.value = false;
    const request = requests.begin("clear");
    clearing.value = true; notice.value = ""; options.errorMessage.value = "";
    try {
      const result = await options.api.clearChatStorage(request.signal);
      if (request.isCurrent()) { apply(result); notice.value = options.tr("chatStorageCleared"); }
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) clearing.value = false; request.finish(); }
  }

  function reset(): void {
    requests.reset();
    clearTimeout(armTimer);
    loading.value = false; saving.value = false; clearing.value = false; clearArmed.value = false; notice.value = ""; loaded.value = false;
  }
  onScopeDispose(reset);

  return { form, usage, saved, loading, saving, clearing, clearArmed, notice, loaded, load, save, clear, reset };
}

export type AdminChatStorageModel = ReturnType<typeof useAdminChatStorage>;
