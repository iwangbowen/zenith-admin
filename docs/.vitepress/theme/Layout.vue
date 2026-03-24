<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import DocLastUpdated from './components/DocLastUpdated.vue'

const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #doc-footer-before>
      <DocLastUpdated />
    </template>
  </Layout>
</template>
