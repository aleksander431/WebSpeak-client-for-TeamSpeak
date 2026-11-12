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

export interface AdminEditorLink {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  devices: Array<{ id: string; name: string; status: "pending" | "approved" | "denied"; requestedAt: string; decidedAt?: string; lastSeenAt?: string }>;
  drafts: Array<{ id: string; title: string; updatedAt: string; publishedId?: string; publishedAt?: string }>;
  bytes: number;
}

/** Uploaded D&D adventure packages and adventure editor links for the admin console. */
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

  // ---- Adventure editor links ----
  const links = ref<AdminEditorLink[]>([]);
  const linkLabel = ref("");
  const linkArmed = ref("");
  const copied = ref("");
  let linkArmTimer: ReturnType<typeof setTimeout> | undefined;

  async function loadLinks(): Promise<void> {
    const request = requests.begin("links");
    try {
      const result = await options.api.editorLinks(request.signal);
      if (request.isCurrent()) links.value = result.links;
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { request.finish(); }
  }

  async function createLink(): Promise<void> {
    const label = linkLabel.value.trim();
    if (!label) return;
    const request = requests.begin("create-link");
    try {
      const result = await options.api.createEditorLink(label, request.signal);
      if (!request.isCurrent()) return;
      links.value = result.links;
      linkLabel.value = "";
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { request.finish(); }
  }

  async function removeLink(id: string): Promise<void> {
    if (linkArmed.value !== id) {
      linkArmed.value = id;
      clearTimeout(linkArmTimer);
      linkArmTimer = setTimeout(() => { linkArmed.value = ""; }, 4000);
      return;
    }
    linkArmed.value = "";
    const request = requests.begin(`remove-link:${id}`);
    try {
      const result = await options.api.deleteEditorLink(id, request.signal);
      if (request.isCurrent()) links.value = result.links;
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { request.finish(); }
  }

  async function decide(linkId: string, deviceId: string, action: "approved" | "denied" | "remove"): Promise<void> {
    const request = requests.begin(`device:${deviceId}`);
    try {
      const result = await options.api.decideEditorDevice(linkId, deviceId, action, request.signal);
      if (request.isCurrent()) links.value = result.links;
    } catch (error) { if (request.isCurrent()) report(error); }
    finally { request.finish(); }
  }

  function linkUrl(link: AdminEditorLink): string {
    return `${window.location.origin}/create/${link.token}`;
  }

  async function copyLink(link: AdminEditorLink): Promise<void> {
    try {
      await navigator.clipboard.writeText(linkUrl(link));
      copied.value = link.id;
      setTimeout(() => { if (copied.value === link.id) copied.value = ""; }, 2000);
    } catch { /* the link is shown and can be selected by hand */ }
  }

  return {
    items, limitBytes, loading, uploading, notice, armed, problem, load, upload, remove,
    links, linkLabel, linkArmed, copied, loadLinks, createLink, removeLink, decide, linkUrl, copyLink,
  };
}

export type AdminAdventuresModel = ReturnType<typeof useAdminAdventures>;
