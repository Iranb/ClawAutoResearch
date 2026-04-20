import { defineConfig } from 'vitepress';

const repository = process.env.GITHUB_REPOSITORY ?? 'Iranb/ClawAutoResearch';
const repositoryName = repository.split('/')[1] ?? 'ClawAutoResearch';
const docsBase =
  process.env.DOCS_BASE ??
  (process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/');

const englishThemeConfig = {
  logo: '/favicon.svg',
  siteTitle: 'ClawAutoResearch Docs',
  nav: [
    { text: 'Overview', link: '/en/' },
    { text: 'User Guide', link: '/en/user-guide/' },
    { text: 'Technical Docs', link: '/en/technical/' },
    { text: 'Architecture', link: '/en/architecture/' },
    { text: 'Reference', link: '/en/reference/' },
    { text: 'Operations', link: '/en/operations/' },
  ],
  sidebar: {
    '/en/user-guide/': [
      {
        text: 'User Guide',
        items: [
          { text: 'Entry', link: '/en/user-guide/' },
          { text: 'Installation', link: '/en/user-guide/installation' },
          { text: 'Usage', link: '/en/user-guide/usage' },
          { text: 'Workflow Tour', link: '/en/user-guide/workflow-tour' },
          { text: 'Slash Commands', link: '/en/user-guide/slash-commands' },
        ],
      },
    ],
    '/en/technical/': [
      {
        text: 'Technical Docs',
        items: [
          { text: 'Entry', link: '/en/technical/' },
          { text: 'Architecture', link: '/en/architecture/' },
          { text: 'Reference', link: '/en/reference/' },
          { text: 'Operations', link: '/en/operations/' },
        ],
      },
    ],
    '/en/architecture/': [
      {
        text: 'Architecture',
        items: [
          { text: 'Overview', link: '/en/architecture/' },
          { text: 'System Workflows', link: '/en/architecture/system-workflows' },
          { text: 'Discord Reporting', link: '/en/architecture/discord-reporting' },
        ],
      },
    ],
    '/en/reference/': [
      {
        text: 'Reference',
        items: [
          { text: 'Entry', link: '/en/reference/' },
        ],
      },
    ],
    '/en/operations/': [
      {
        text: 'Operations',
        items: [
          { text: 'Entry', link: '/en/operations/' },
        ],
      },
    ],
  },
  socialLinks: [{ icon: 'github', link: 'https://github.com/Iranb/ClawAutoResearch' }],
  outline: {
    level: [2, 3],
    label: 'On This Page',
  },
  docFooter: {
    prev: 'Previous',
    next: 'Next',
  },
  footer: {
    message: 'Standalone documentation site for ClawAutoResearch.',
    copyright: 'MIT Licensed | ClawAutoResearch',
  },
};

export default defineConfig({
  title: 'ClawAutoResearch Docs',
  description:
    'OpenClaw 自动科研插件的统一文档站，覆盖工作流控制平面、PaperNexus 图谱、Agent/Skill、状态合同、运行时工具和开发运维。',
  lang: 'zh-CN',
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'ClawAutoResearch Docs',
      description:
        'Bilingual documentation portal for ClawAutoResearch, covering onboarding, architecture, workflow control, and high-level system flows.',
      themeConfig: englishThemeConfig,
    },
  },
  srcDir: '.',
  srcExclude: [
    'DOC/**',
    '_drafts/**',
    'superpowers/**',
  ],
  ignoreDeadLinks: [/^\/Users\//],
  cleanUrls: true,
  lastUpdated: true,
  base: docsBase,
  markdown: {
    config(md) {
      const defaultFence =
        md.renderer.rules.fence?.bind(md.renderer.rules) ??
        ((tokens, idx, options, env, self) =>
          self.renderToken(tokens, idx, options));
      md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        const language = token.info.trim().split(/\s+/, 1)[0];
        if (language === 'mermaid') {
          return `<MermaidBlock code="${encodeURIComponent(token.content)}" />`;
        }
        return defaultFence(tokens, idx, options, env, self);
      };
    },
  },
  head: [
    ['meta', { name: 'theme-color', content: '#0f766e' }],
    ['meta', { property: 'og:title', content: 'ClawAutoResearch Docs' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          '完整介绍 ClawAutoResearch 系统的功能、架构、状态机、图谱链路、角色边界、工具接口与 GitHub Pages 部署。',
      },
    ],
  ],
  themeConfig: {
    logo: '/favicon.svg',
    siteTitle: 'ClawAutoResearch Docs',
    search: {
      provider: 'local',
    },
    nav: [
      { text: 'Overview', link: '/' },
      { text: '用户文档', link: '/user-guide/' },
      { text: '技术文档', link: '/technical/' },
      { text: 'Architecture', link: '/architecture/' },
      { text: 'Reference', link: '/reference/' },
      { text: 'Operations', link: '/operations/' },
    ],
    sidebar: {
      '/user-guide/': [
        {
          text: '用户文档',
          items: [
            { text: '入口说明', link: '/user-guide/' },
            { text: '安装指南', link: '/user-guide/installation' },
            { text: '使用指南', link: '/user-guide/usage' },
            { text: '流程介绍', link: '/user-guide/workflow-tour' },
            { text: 'Slash Commands 总览', link: '/user-guide/slash-commands' },
            { text: '快速路径说明', link: '/user-guide/quickstart-tutorial' },
            { text: '项目生命周期', link: '/get-started/project-lifecycle' },
          ],
        },
      ],
      '/get-started/': [
        {
          text: '上手细节',
          items: [
            { text: '入口与阅读顺序', link: '/get-started/' },
            { text: '安装与启用', link: '/get-started/installation' },
            { text: '项目生命周期', link: '/get-started/project-lifecycle' },
          ],
        },
      ],
      '/technical/': [
        {
          text: '技术文档',
          items: [
            { text: '入口说明', link: '/technical/' },
            { text: '架构设计', link: '/architecture/' },
            { text: '运行时参考', link: '/reference/' },
            { text: '开发与运维', link: '/operations/' },
            { text: '内部设计历史', link: '/internal-history' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '系统设计',
          items: [
            { text: '体系总览', link: '/architecture/' },
            { text: '系统特性与 Workflow 流程总览', link: '/architecture/system-workflows' },
            { text: 'Workflow 向 Discord 汇报的节点', link: '/architecture/discord-reporting' },
            { text: 'Workflow 控制平面', link: '/architecture/workflow-control-plane' },
            { text: 'Broad Paper Search', link: '/architecture/broad-paper-search' },
            { text: 'Workflow Hooks', link: '/architecture/workflow-hooks' },
            { text: 'Auto Pipeline Handoffs', link: '/architecture/auto-pipeline-handoffs' },
            { text: 'Lobster Handoffs', link: '/architecture/lobster-handoffs' },
            { text: 'Graph 与 Memory', link: '/architecture/graph-memory' },
            { text: 'Agents 与 Skills', link: '/architecture/agents-and-skills' },
            { text: 'Writing 与 Review', link: '/architecture/writing-and-review' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '运行时接口',
          items: [
            { text: '参考索引', link: '/reference/' },
            { text: 'Commands 与 Tools', link: '/reference/commands-and-tools' },
            { text: 'State Contracts', link: '/reference/state-contracts' },
            { text: 'Module Map', link: '/reference/module-map' },
            { text: 'Configuration', link: '/reference/configuration' },
          ],
        },
      ],
      '/operations/': [
        {
          text: '开发与运维',
          items: [
            { text: '运维索引', link: '/operations/' },
            { text: '测试与调试', link: '/operations/testing-and-debugging' },
            { text: 'GitHub Pages 部署', link: '/operations/github-pages' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Iranb/ClawAutoResearch' }],
    outline: {
      level: [2, 3],
      label: 'On This Page',
    },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    footer: {
      message: 'Unified docs portal for the OpenClaw automated research control plane.',
      copyright: 'MIT Licensed | ClawAutoResearch',
    },
  },
});
