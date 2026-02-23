import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainClaw",
  description: "Self-hosted DeFi agent platform",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "GitHub", link: "https://github.com/chainclaw-xyz/chainclaw" },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/chainclaw-xyz/chainclaw" }],
  },
});
