<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  code: string;
}>();

let blockCounter = 0;
let mermaidLoader: Promise<any> | null = null;

const svg = ref('');
const error = ref<string | null>(null);
const isRendering = ref(true);
const diagramId = `vp-mermaid-${++blockCounter}`;
const decodedCode = computed(() => decodeURIComponent(props.code));
const isDark = computed(() =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')
);

let themeObserver: MutationObserver | null = null;

async function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then((module) => module.default ?? module);
  }
  return mermaidLoader;
}

async function renderDiagram() {
  isRendering.value = true;
  try {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark.value ? 'dark' : 'default',
    });
    const rendered = await mermaid.render(diagramId, decodedCode.value);
    svg.value = rendered.svg;
    error.value = null;
  } catch (renderError) {
    svg.value = '';
    error.value =
      renderError instanceof Error ? renderError.message : String(renderError);
  } finally {
    isRendering.value = false;
  }
}

onMounted(() => {
  void renderDiagram();
  themeObserver = new MutationObserver(() => {
    void renderDiagram();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
});

onBeforeUnmount(() => {
  themeObserver?.disconnect();
  themeObserver = null;
});

watch(
  () => decodedCode.value,
  () => {
    void renderDiagram();
  }
);
</script>

<template>
  <ClientOnly>
    <div class="vp-mermaid">
      <div
        v-if="svg"
        class="vp-mermaid__diagram"
        v-html="svg"
      />
      <div
        v-else-if="isRendering"
        class="vp-mermaid__loading"
      >
        Rendering diagram...
      </div>
      <div v-else class="vp-mermaid__error">
        <p>Mermaid diagram failed to render.</p>
        <pre><code>{{ decodedCode }}</code></pre>
        <p v-if="error">{{ error }}</p>
      </div>
    </div>
  </ClientOnly>
</template>
