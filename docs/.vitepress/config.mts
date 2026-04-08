import { defineConfig } from 'vitepress';

const repository = process.env.GITHUB_REPOSITORY ?? 'Iranb/ClawAutoResearch';
const repositoryName = repository.split('/')[1] ?? 'ClawAutoResearch';
const docsBase =
  process.env.DOCS_BASE ??
  (process.env.GITHUB_ACTIONS === 'true' ? `/${repositoryName}/` : '/');

export default defineConfig({
  title: 'ClawAutoResearch Docs',
  description:
    'OpenClaw 自动科研插件的统一文档站，覆盖工作流控制平面、PaperNexus 图谱、Agent/Skill、状态合同、运行时工具和开发运维。',
  lang: 'zh-CN',
  srcDir: '.',
  srcExclude: ['DOC/**', '_drafts/**'],
  ignoreDeadLinks: [/^\/Users\//],
  cleanUrls: true,
  lastUpdated: true,
  base: docsBase,
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
      { text: 'Get Started', link: '/get-started/' },
      { text: 'Workflow', link: '/architecture/workflow-control-plane' },
      { text: 'Graph & Memory', link: '/architecture/graph-memory' },
      { text: 'Agents & Skills', link: '/architecture/agents-and-skills' },
      { text: 'Runtime & Reference', link: '/reference/' },
      { text: 'Dev & Ops', link: '/operations/' },
      { text: 'Internal History', link: '/internal-history' },
    ],
    sidebar: {
      '/get-started/': [
        {
          text: '快速开始',
          items: [
            { text: '入口与阅读顺序', link: '/get-started/' },
            { text: '安装与启用', link: '/get-started/installation' },
            { text: '项目生命周期', link: '/get-started/project-lifecycle' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: '系统设计',
          items: [
            { text: '体系总览', link: '/architecture/' },
            { text: 'Workflow 控制平面', link: '/architecture/workflow-control-plane' },
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
