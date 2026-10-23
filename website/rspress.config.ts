import { defineConfig } from "@rspress/core";

const description = "A simpler, more approachable fluent TypeScript API for Mediabunny.";

export default defineConfig({
  title: "fluent-mediabunny",
  description,
  lang: "en",
  locales: [
    { lang: "en", label: "English", title: "fluent-mediabunny", description },
    {
      lang: "zh",
      label: "简体中文",
      title: "fluent-mediabunny",
      description: "为 Mediabunny 提供更简单、易理解的 TypeScript 链式 API。",
    },
  ],
  route: {
    // Cloudflare auto-trailing-slash serves /guide/convert from convert.html.
    // A .html link on that path redirects on a hard load.
    cleanUrls: true,
  },
  languageParity: { enabled: true },
  markdown: {
    link: {
      checkDeadLinks: true,
      checkAnchors: true,
    },
  },
  themeConfig: {
    socialLinks: [
      {
        icon: "github",
        mode: "link",
        content: "https://github.com/Yukiniro/fluent-mediabunny",
      },
    ],
  },
});
