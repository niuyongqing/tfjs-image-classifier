<template>
  <div class="h-full flex flex-col bg-gray-50 border-r border-gray-200 overflow-hidden">
    
    <!-- 顶部标题栏 -->
    <div class="bg-white px-4 py-3 border-b border-gray-200 flex justify-between items-center shadow-sm z-10">
      <div class="flex items-center gap-2">
        <el-icon :size="20" class="text-blue-600"><Tools /></el-icon>
        <span class="font-bold text-gray-800 text-lg">训练工作台</span>
      </div>
      
      <!-- 右侧控制区 -->
      <div class="flex items-center gap-3">
        <!-- 自动训练开关 -->
        <div class="flex items-center gap-2 mr-2 bg-blue-50 px-2 py-1 rounded border border-blue-100">
          <span class="text-xs text-blue-600 font-bold">无人值守模式</span>
          <el-switch 
            v-model="isAutoMode" 
            size="small" 
            active-text="开" 
            inactive-text="关"
            @change="toggleAutoMode"
          />
        </div>

        <el-button type="primary" plain size="small" :loading="isSyncing" @click="fetchCloudData(true)">
          <el-icon class="mr-1"><Download /></el-icon> 同步新数据
        </el-button>
        <el-tag :type="isTraining ? 'warning' : 'success'" effect="dark" round>
          {{ isTraining ? '正在训练...' : '系统就绪' }}
        </el-tag>
      </div>
    </div>

    <!-- 可滚动区域 -->
    <div class="flex-1 overflow-y-auto p-4 space-y-4">
      
      <!-- 1. 数据概览 -->
      <el-card shadow="hover" :body-style="{ padding: '15px' }">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-statistic title="总样本数" :value="allDataset.length">
              <template #suffix>
                <el-icon style="vertical-align: -0.125em"><Picture /></el-icon>
              </template>
            </el-statistic>
          </el-col>
          <el-col :span="12">
            <el-statistic title="分类数量" :value="uniqueLabels.length">
              <template #suffix>
                <el-icon style="vertical-align: -0.125em"><PriceTag /></el-icon>
              </template>
            </el-statistic>
          </el-col>
        </el-row>
      </el-card>

      <!-- 2. 数据管理 -->
      <el-card shadow="hover" class="data-card">
        <template #header>
          <div class="flex justify-between items-center">
            <span class="font-bold">数据录入</span>
            <el-button v-if="allDataset.length > 0" type="primary" link @click="loadData">
              <el-icon><Refresh /></el-icon> 刷新列表
            </el-button>
          </div>
        </template>

        <!-- 输入与上传 -->
        <div class="flex gap-2 mb-4">
          <el-input 
            v-model="currentLabel" 
            placeholder="输入标签 (如: cat)" 
            clearable
            @keyup.enter="triggerUpload"
          >
            <template #prepend>标签</template>
          </el-input>
          
          <el-upload
            ref="uploadRef"
            action="#"
            :auto-upload="false"
            :show-file-list="false"
            :on-change="handleFileChange"
            accept="image/*"
            multiple
          >
            <template #trigger>
              <el-button type="primary" :loading="isProcessingUpload" @click="checkLabelBeforeUpload">
                <el-icon class="el-icon--left"><Upload /></el-icon>上传
              </el-button>
            </template>
          </el-upload>
        </div>

        <!-- 筛选与管理 -->
        <div v-if="uniqueLabels.length > 0" class="flex justify-between items-center mb-4 bg-gray-50 p-2 rounded">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500">筛选分类:</span>
            <el-select v-model="filterLabel" placeholder="全部显示" size="small" style="width: 140px" clearable>
              <el-option
                v-for="lbl in uniqueLabels"
                :key="lbl"
                :label="`${lbl} (${labelCounts[lbl]})`"
                :value="lbl"
              />
            </el-select>
          </div>
          <el-button 
            v-if="filterLabel" 
            type="danger" 
            size="small" 
            plain 
            @click="deleteByLabel(filterLabel)"
          >
            删除 {{ filterLabel }}
          </el-button>
        </div>

        <!-- 图片预览列表 (AutoAnimate) -->
        <div class="image-grid-container h-48 overflow-y-auto pr-1">
          <div ref="listRef" class="grid grid-cols-4 gap-2" v-auto-animate>
            <div 
              v-for="item in paginatedData" 
              :key="item.id" 
              class="relative group aspect-square border border-gray-200 rounded overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer"
            >
              <!-- item.image 是后端 URL -->
              <el-image 
                :src="item.image" 
                class="w-full h-full" 
                fit="cover" 
                loading="lazy"
              />
              <div class="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center">
                <span class="text-xs text-white truncate block">{{ item.label }}</span>
              </div>
              <!-- 删除遮罩 -->
              <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <el-button type="danger" circle size="small" @click="deleteItem(item.id)">
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
            
            <!-- 空状态 -->
            <div v-if="paginatedData.length === 0" class="col-span-4 py-8 flex justify-center">
              <el-empty description="暂无数据" :image-size="60" />
            </div>
          </div>
        </div>
        
        <!-- 分页 -->
        <div class="mt-3 flex justify-center">
           <el-pagination
            v-if="filteredData.length > pageSize"
            small
            background
            layout="prev, pager, next"
            :total="filteredData.length"
            :page-size="pageSize"
            v-model:current-page="currentPage"
          />
        </div>
      </el-card>

      <!-- 3. 模型参数配置 -->
      <el-card shadow="hover" :body-style="{ padding: '10px 20px' }">
        <template #header>
          <div class="flex justify-between items-center cursor-pointer" @click="showConfig = !showConfig">
            <span class="font-bold">训练参数</span>
            <el-icon :class="{'rotate-180': showConfig}" class="transition-transform duration-300"><ArrowDown /></el-icon>
          </div>
        </template>
        
        <el-collapse-transition>
          <div v-show="showConfig">
            <el-form label-position="top" size="small">
              <el-row :gutter="15">
                <el-col :span="12">
                  <el-form-item label="训练轮数 (Epochs)">
                    <el-input-number v-model="config.epochs" :min="1" :max="100" class="w-full" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="批次大小 (Batch Size)">
                    <el-input-number v-model="config.batchSize" :min="1" :max="128" class="w-full" />
                  </el-form-item>
                </el-col>
              </el-row>
              
              <el-form-item label="验证集比例">
                <el-slider v-model="config.validationSplit" :min="0" :max="0.3" :step="0.05" show-stops :format-tooltip="val => (val * 100) + '%'" />
              </el-form-item>

              <el-form-item style="margin-bottom: 0;">
                 <el-checkbox v-model="config.useIncremental" label="启用增量训练模式" border />
              </el-form-item>
            </el-form>
          </div>
        </el-collapse-transition>
      </el-card>

    </div>

    <!-- 4. 底部固定控制区 -->
    <div class="bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] flex-none flex flex-col min-h-[300px]">
      
      <!-- 启动按钮 -->
      <div class="flex gap-2 mb-4">
        <el-button 
          type="primary" 
          size="large" 
          class="flex-1 font-bold" 
          :loading="isTraining"
          :disabled="allDataset.length < 2"
          @click="startTraining(false)"
        >
          {{ isTraining ? '模型训练中...' : '🚀 开始训练' }}
        </el-button>
        
        <el-button 
          type="success" 
          size="large" 
          class="flex-1 font-bold" 
          :loading="isPublishing"
          @click="publishModel"
        >
          发布模型到后端
        </el-button>
      </div>

      <!-- 特征提取进度 -->
      <div v-if="featureProcess.total > 0 && !featureProcess.done" class="mb-4">
        <div class="flex justify-between text-xs text-gray-600 mb-1">
          <span>特征提取中...</span>
          <span>{{ featureProcess.processed }}/{{ featureProcess.total }}</span>
        </div>
        <el-progress 
          :percentage="Math.round((featureProcess.processed / featureProcess.total) * 100)" 
          :stroke-width="10" 
          striped 
          striped-flow 
        />
      </div>

      <!-- 训练指标 -->
      <div v-if="trainStatus.epoch > 0 || trainStatus.completed" class="flex gap-4 justify-center mb-3">
         <el-tag type="danger" effect="plain">Loss: {{ trainStatus.loss.toFixed(4) }}</el-tag>
         <el-tag type="success" effect="plain">Acc: {{ (trainStatus.acc * 100).toFixed(1) }}%</el-tag>
         <el-tag v-if="trainStatus.val_acc" type="primary" effect="plain">Val: {{ (trainStatus.val_acc * 100).toFixed(1) }}%</el-tag>
      </div>

      <!-- 图表容器 -->
      <div class="flex-1 relative w-full border border-gray-100 rounded bg-gray-50 p-2 min-h-0">
         <canvas ref="chartCanvas"></canvas>
         <div v-if="!isTraining && !trainStatus.completed" class="absolute inset-0 flex items-center justify-center text-gray-300 pointer-events-none">
           <div class="text-center">
             <el-icon :size="40"><DataLine /></el-icon>
             <p class="text-xs mt-1">训练图表区域</p>
           </div>
         </div>
      </div>

    </div>
  </div>
</template>

<script setup>
// 🌟 1. 彻底移除 db (Dexie) 引用
import { tfService } from '../utils/tfService';
import { compressImage } from '../utils/imageUtils'; 
import Chart from 'chart.js/auto';
// 自动导入插件会自动处理 Vue 和 Element Plus 的 API

const API_BASE = 'http://localhost:3000/api';

const currentLabel = ref('');
const allDataset = shallowRef([]); 
const isTraining = ref(false);
const isProcessingUpload = ref(false);
const isSyncing = ref(false);
const isPublishing = ref(false);

const filterLabel = ref('');
const currentPage = ref(1);
const pageSize = 12; 
const showConfig = ref(true); 

let chartInstance = null;
const chartCanvas = ref(null);
const uploadRef = ref(null);

// 自动化相关
const isAutoMode = ref(false);
let autoTrainTimer = null;

// 配置
const savedConfig = JSON.parse(localStorage.getItem('training_config') || '{}');
const config = ref({
  epochs: 20, batchSize: 16, learningRate: 0.001, validationSplit: 0.1, useIncremental: false,
  ...savedConfig
});
watch(config, (newVal) => localStorage.setItem('training_config', JSON.stringify(newVal)), { deep: true });

// 状态
const trainStatus = ref({ epoch: 0, loss: 0, acc: 0, val_acc: undefined, completed: false });
const featureProcess = ref({ processed: 0, total: 0, done: false });

// 计算属性
const uniqueLabels = computed(() => {
  const labels = new Set(allDataset.value.map(d => d.label));
  return Array.from(labels).sort();
});
const labelCounts = computed(() => {
  const counts = {};
  allDataset.value.forEach(d => { counts[d.label] = (counts[d.label] || 0) + 1; });
  return counts;
});
const filteredData = computed(() => {
  if (!filterLabel.value) return allDataset.value;
  return allDataset.value.filter(item => item.label === filterLabel.value);
});
const paginatedData = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredData.value.slice(start, start + pageSize);
});
watch(filterLabel, () => currentPage.value = 1);

// 🌟 API: 加载数据
const loadData = async () => {
  try {
    const res = await fetch(`${API_BASE}/dataset`);
    const json = await res.json();
    if (json.success) {
      allDataset.value = json.data; 
    }
  } catch (e) {
    ElMessage.error("无法连接到后端服务器");
  }
};

// 🌟 API: 同步新数据
const fetchCloudData = async (isManualClick = true) => {
  if (isSyncing.value || isTraining.value) return; 

  isSyncing.value = true;
  try {
    // 1. 查是否有新数据
    const res = await fetch(`${API_BASE}/pending-data`);
    const json = await res.json();
    
    if (!json.success || json.data.length === 0) {
      if (isManualClick) ElMessage.info('暂无待训练数据');
      return;
    }

    const trainedIds = json.data.map(doc => doc._id);
    const count = trainedIds.length;

    // 2. 告诉后端：这些数据我收到了，请转正
    await fetch(`${API_BASE}/mark-trained`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: trainedIds })
    });
    
    // 3. 刷新列表
    await loadData();
    
    if (isAutoMode.value) {
      ElNotification({
        title: '自动训练启动',
        message: `检测到 ${count} 条新数据，开始自动训练...`,
        type: 'success'
      });
      startTraining(true);
    } else {
      ElMessage.success(`成功同步 ${count} 条样本！`);
    }

  } catch (err) {
    console.error(err);
    if (isManualClick) ElMessage.error('同步失败: 请检查后端服务');
  } finally {
    isSyncing.value = false;
  }
};

// 🌟 API: 上传
const handleFileChange = async (uploadFile) => {
  if (!currentLabel.value) return; 
  isProcessingUpload.value = true;
  try {
    const file = uploadFile.raw;
    const compressedBase64 = await compressImage(file);
    
    const res = await fetch(`${API_BASE}/dataset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label: currentLabel.value,
        image: compressedBase64
      })
    });
    
    const json = await res.json();
    if (json.success) {
      allDataset.value = [json.data, ...allDataset.value]; // 本地立即更新
      if (!filterLabel.value) filterLabel.value = currentLabel.value;
      ElMessage.success(`已上传`);
    } else {
      throw new Error(json.error);
    }
    uploadRef.value.clearFiles();
  } catch (error) {
    ElMessage.error("上传失败: " + error.message);
  } finally {
    isProcessingUpload.value = false;
  }
};

// 🌟 API: 删除
const deleteItem = async (id) => {
  try {
    await fetch(`${API_BASE}/dataset/${id}`, { method: 'DELETE' });
    allDataset.value = allDataset.value.filter(item => item.id !== id);
  } catch (e) { ElMessage.error("删除失败"); }
};

const deleteByLabel = async (label) => {
  try {
    await ElMessageBox.confirm(`确定删除 "${label}" 下所有图片？`, '警告', { type: 'warning' });
    await fetch(`${API_BASE}/dataset/label/${label}`, { method: 'DELETE' });
    await loadData();
    filterLabel.value = '';
    ElMessage.success('删除成功');
  } catch {}
};

// 🌟 API: 发布模型
const publishModel = async () => {
  if (!tfService.classifierModel) return ElMessage.warning('请先完成训练');
  isPublishing.value = true;
  try {
    await tfService.classifierModel.save(
      tf.io.browserHTTPRequest(`${API_BASE}/upload-model`)
    );
    await fetch(`${API_BASE}/upload-labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: tfService.labels })
    });
    ElNotification({ title: '发布成功', message: '模型已更新到后端 API', type: 'success' });
  } catch (e) {
    ElMessage.error('发布失败');
  } finally {
    isPublishing.value = false;
  }
};

// 切换自动模式
const toggleAutoMode = (val) => {
  if (val) {
    ElNotification.success({ title: '无人值守模式已开启', message: '系统将自动检查新数据并训练。', duration: 5000 });
    fetchCloudData(false);
    autoTrainTimer = setInterval(() => {
      if (!isTraining.value && !isSyncing.value) fetchCloudData(false);
    }, 30000);
  } else {
    if (autoTrainTimer) clearInterval(autoTrainTimer);
    ElMessage.info('已关闭自动模式');
  }
};

// 辅助函数
const checkLabelBeforeUpload = () => { if (!currentLabel.value) return ElMessage.warning('请先输入标签名称'); };
const triggerUpload = () => { if (!currentLabel.value) return ElMessage.warning('请输入标签'); ElMessage.info('请点击上传按钮'); };
const clearData = async () => {
  // 暂时只支持本地清空视图，后端全量清空比较危险，暂不实现
  try {
    await ElMessageBox.confirm('这只会清空当前视图，后端数据不会删除。确定？', '提示', { type: 'warning' });
    allDataset.value = [];
    ElMessage.success('视图已清空');
  } catch {}
};

const initChart = () => {
  if (chartInstance) chartInstance.destroy();
  if (!chartCanvas.value) return;
  chartInstance = new Chart(chartCanvas.value, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        { label: 'Loss', data: [], borderColor: '#f56c6c', tension: 0.3, pointRadius: 0 },
        { label: 'Acc', data: [], borderColor: '#67c23a', tension: 0.3, pointRadius: 0 },
        { label: 'Val Acc', data: [], borderColor: '#409eff', borderDash: [5, 5], tension: 0.3, pointRadius: 0 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, animation: false }
  });
};

// 🌟 训练入口
const startTraining = async (autoPublish = false) => {
  if (allDataset.value.length < 2) return ElMessage.warning('样本不足');
  
  isTraining.value = true;
  trainStatus.value.completed = false;
  featureProcess.value = { processed: 0, total: 0, done: false };
  initChart();

  try {
    // 🌟 关键：直接将内存中的 allDataset 传给 tfService
    // tfService.train 会处理 URL 图片
    await tfService.train(
      allDataset.value, 
      config.value,
      {
        onEpochEnd: (epoch, logs) => {
          trainStatus.value = { epoch: epoch + 1, loss: logs.loss, acc: logs.acc, val_acc: logs.val_acc, completed: false };
          if (chartInstance) {
            chartInstance.data.labels.push(epoch + 1);
            chartInstance.data.datasets[0].data.push(logs.loss);
            chartInstance.data.datasets[1].data.push(logs.acc);
            chartInstance.data.datasets[2].data.push(logs.val_acc);
            chartInstance.update();
          }
        },
        onBatchProcess: (processed, total) => {
          featureProcess.value = { processed, total, done: processed >= total };
        }
      }
    );
    trainStatus.value.completed = true;
    
    if (autoPublish) await publishModel();
    else ElMessage.success('模型训练完成！');

  } catch (err) {
    ElMessage.error('训练出错: ' + err.message);
  } finally {
    isTraining.value = false;
  }
};

onUnmounted(() => {
  if (chartInstance) chartInstance.destroy();
  if (autoTrainTimer) clearInterval(autoTrainTimer);
});

onMounted(async () => {
  await loadData();
  nextTick(() => initChart());
});
</script>

<style scoped>
.image-grid-container::-webkit-scrollbar { width: 6px; }
.image-grid-container::-webkit-scrollbar-thumb { background: #dcdfe6; border-radius: 4px; }
</style>