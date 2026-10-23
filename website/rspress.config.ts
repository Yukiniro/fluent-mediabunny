import { defineConfig } from "@rspress/core";

const description = "A simpler, more approachable fluent TypeScript API for Mediabunny.";
const socialImage =
  "https://raw.githubusercontent.com/Yukiniro/fluent-mediabunny/main/website/docs/public/og.png";

export default defineConfig({
  title: "fluentbunny",
  logo: "/logo.png",
  logoText: "fluentbunny",
  icon: "/favicon.png",
  description,
  head: [
    ["meta", { property: "og:site_name", content: "fluentbunny" }],
    ["meta", { property: "og:image", content: socialImage }],
    ["meta", { property: "og:image:width", content: "1200" }],
    ["meta", { property: "og:image:height", content: "630" }],
    ["meta", { property: "og:image:alt", content: "fluentbunny: Media tasks. Made readable." }],
    ["meta", { name: "twitter:card", content: "summary_large_image" }],
    ["meta", { name: "twitter:image", content: socialImage }],
  ],
  lang: "en",
  locales: [
    { lang: "en", label: "English", title: "fluentbunny", description },
    {
      lang: "zh",
      label: "简体中文",
      title: "fluentbunny",
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
