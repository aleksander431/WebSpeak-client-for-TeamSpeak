import { reactive, ref, type Ref } from "vue";
import type { copy } from "../i18n/admin.js";
import { AdminApiError, isAdminRequestCancelled, type AdminApi } from "../services/admin-api.js";
import { createAdminRequests } from "../services/admin-requests.js";

interface Options {
  api: AdminApi;
  errorMessage: Ref<string>;
  errorText(code?: string): string;
  tr(key: keyof typeof copy.zh, vars?: Record<string, string | number>): string;
}

export interface AdminAdventure {
  id: string;
  title: string;
  summary: string;
  scenes: number;
  heroes: number;
  tracks: number;
  installedAt: string;
  bytes: number;
}

/** Uploaded D&D adventure packages for the admin console. */
export function useAdminAdventures(options: Options) {
  const requests = createAdminRequests();
  const items = ref<AdminAdventure[]>([]);
  const limitBytes = ref(200 * 1024 * 1024);
  const loading = ref(false);
  const uploading = ref(false);
  const notice = ref("");
  /** The adventure whose remove button was pressed once. */
  const armed = ref("");
  const problem = reactive({ text: "" });
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function report(error: unknown): void {
    if (isAdminRequestCancelled(error)) return;
    const code = (error as { code?: string }).code ?? "";
    if (error instanceof AdminApiError && (code.startsWith("ADVENTURE_") || code.startsWith("ZIP_"))) {
      problem.text = `${options.tr("adventuresInvalid")}: ${error.message}`;
      return;
    }
    options.errorMessage.value = options.errorText(code);
  }

  async function load(): Promise<void> {
    const request = requests.begin("load");
    loading.value = true;
    try {
      const result = await options.api.adventures(request.signal);
      if (!request.isCurrent()) return;
      items.value = result.adventures;
      if (result.limitBytes) limitBytes.value = result.limitBytes;
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) loading.value = false; request.finish(); }
  }

  async function upload(file: File): Promise<void> {
    if (uploading.value) return;
    const request = requests.begin("upload");
    uploading.value = true;
    notice.value = "";
    problem.text = "";
    try {
      const result = await options.api.uploadAdventure(file, request.signal);
      if (!request.isCurrent()) return;
      const before = new Set(items.value.map(item => `${item.id}|${item.installedAt}`));
      items.value = result.adventures;
      const added = result.adventures.find(item => !before.has(`${item.id}|${item.installedAt}`));
      notice.value = options.tr("adventuresInstalled", { title: added?.title ?? file.name });
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { if (request.isCurrent()) uploading.value = false; request.finish(); }
  }

  async function remove(id: string): Promise<void> {
    if (armed.value !== id) {
      armed.value = id;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => { armed.value = ""; }, 4000);
      return;
    }
    armed.value = "";
    const request = requests.begin(`remove:${id}`);
    try {
      const result = await options.api.deleteAdventure(id, request.signal);
      if (!request.isCurrent()) return;
      items.value = result.adventures;
      notice.value = options.tr("adventuresRemoved");
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { request.finish(); }
  }

  return { items, limitBytes, loading, uploading, notice, armed, problem, load, upload, remove };
}

export type AdminAdventuresModel = ReturnType<typeof useAdminAdventures>;
