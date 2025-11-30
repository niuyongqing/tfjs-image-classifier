<template>
  <div class="h-screen w-screen flex flex-col font-sans overflow-hidden">
    
    <!-- 全局 Header -->
    <header class="bg-gray-900 text-white h-12 flex items-center justify-between px-4 shadow-lg z-50 flex-none">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center font-bold shadow">
          TF
        </div>
        <h1 class="text-base font-bold tracking-wider opacity-90">TensorFlow.js 图像分类系统 <span class="text-xs font-normal opacity-60 ml-2">Element Plus Edition</span></h1>
      </div>
      
      <div class="flex items-center gap-3 text-xs">
        <el-tag :type="isTfReady ? 'success' : 'info'" size="small" effect="dark">
          TF Core: {{ isTfReady ? 'Ready' : 'Init...' }}
        </el-tag>
        <el-tag :type="useWebGL ? 'success' : 'warning'" size="small" effect="dark">
          WebGL: {{ useWebGL ? 'On' : 'Off' }}
        </el-tag>
      </div>
    </header>

    <!-- 主体内容 -->
    <main class="flex-1 flex overflow-hidden">
      <!-- 左侧：训练 -->
      <section class="flex-1 h-full overflow-hidden relative border-r border-gray-200">
        <TrainingPanel />
      </section>
      
      <!-- 右侧：推理 -->
      <section class="flex-1 h-full overflow-hidden bg-white relative">
        <InferencePanel />
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import * as tf from '@tensorflow/tfjs';
import TrainingPanel from './components/TrainingPanel.vue';
import InferencePanel from './components/InferencePanel.vue';
import { tfService } from './utils/tfService';

const isTfReady = ref(false);
const useWebGL = ref(false);

onMounted(async () => {
  await tf.ready();
  isTfReady.value = true;
  useWebGL.value = tf.getBackend() === 'webgl';
  await tfService.loadBaseModel();
});
</script>

<style>
body {
  margin: 0;
  background-color: #f5f7fa;
}
</style>