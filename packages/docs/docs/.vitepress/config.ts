import { defineConfig } from "vitepress";

export default defineConfig({
  title: "ChainClaw",
  description: "Self-hosted DeFi agent platform",
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      { text: "Guide", link: "/guide/" },
      { text: "Skills SDK", link: "/skills-sdk/" },
      { text: "API", link: "/api/" },
    ],
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "Introduction", link: "/guide/" },
          { text: "Quick Start", link: "/guide/quickstart" },
          { text: "Configuration", link: "/guide/configuration" },
        ],
      },
      {
        text: "Skills SDK",
        items: [
          { text: "Overview", link: "/skills-sdk/" },
          { text: "Creating a Skill", link: "/skills-sdk/creating" },
          { text: "Manifest", link: "/skills-sdk/manifest" },
          { text: "Testing", link: "/skills-sdk/testing" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/chainclaw/chainclaw" }],
  },
});
