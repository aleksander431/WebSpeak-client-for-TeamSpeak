import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { createServer } from "vite";
import { createSSRApp, defineComponent, h, provide } from "vue";
import { renderToString } from "@vue/server-renderer";

// The room sidebar used to show Chinese labels in every language.
let vite, VoiceServerHeader, VoiceChannelTree, WEB_CLIENT_T, translations;
before(async () => {
  vite = await createServer({ configFile: false, plugins: [vue()], root: fileURLToPath(new URL("../", import.meta.url)), server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  ({ default: VoiceServerHeader } = await vite.ssrLoadModule("/src/components/web-client/VoiceServerHeader.vue"));
  ({ default: VoiceChannelTree } = await vite.ssrLoadModule("/src/components/web-client/VoiceChannelTree.vue"));
  ({ WEB_CLIENT_T } = await vite.ssrLoadModule("/src/composables/useWebClientT.ts"));
  ({ webClientTranslations: translations } = await vite.ssrLoadModule("/src/i18n/web-client.ts"));
});
after(async () => { await vite?.close(); });

const CJK = /[぀-ヿ一-鿿]/;

for (const language of ["ru", "en", "de"]) {
  test(`room header and channel tree show no Chinese text in ${language}`, async () => {
    const t = (key, variables = {}) => (translations[language][key] ?? translations.en[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(variables[name] ?? ""));
    const channels = [
      { id: "1", parentID: "0", depth: 0, name: "Krya", isPermanent: true, members: [{ id: 5, nickname: "afire.", isSelf: true }] },
      { id: "2", parentID: "0", depth: 0, name: "Coding", isPermanent: true, passwordProtected: true, members: [] },
    ];
    const Page = defineComponent({
      setup() {
        provide(WEB_CLIENT_T, t);
        return () => h("div", [
          h(VoiceServerHeader, { serverLabel: "Server", connectionState: "connected", servers: [], onSwitchServer: () => {} }),
          h(VoiceChannelTree, { channels, currentChannelId: "1", layout: "server-sidebar", avatarStyle: () => ({}), avatarInitial: (name) => name[0], isSpeaking: () => false, t }),
        ]);
      },
    });
    const html = await renderToString(createSSRApp(Page));
    assert.doesNotMatch(html, CJK, html.match(new RegExp(`.{0,60}${CJK.source}.{0,20}`))?.[0]);
    assert.ok(html.includes(t("statusConnected")), "connection badge");
    assert.ok(html.includes(t("you")), "own member mark");
    assert.ok(html.includes(t("channelJoinTitle", { name: "Coding" })), "join hint on the channel row");
  });
}
