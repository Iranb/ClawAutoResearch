import DefaultTheme from 'vitepress/theme';
import './custom.css';
import MermaidBlock from './components/MermaidBlock.vue';

export default {
  ...DefaultTheme,
  enhanceApp({ app }) {
    app.component('MermaidBlock', MermaidBlock);
  },
};
