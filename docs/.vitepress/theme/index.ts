import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import FeatureMatrixFlow from './components/FeatureMatrixFlow.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('FeatureMatrixFlow', FeatureMatrixFlow);
  },
};
