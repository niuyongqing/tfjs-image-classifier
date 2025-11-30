<template>
  <div class="h-full flex flex-col bg-gray-50 border-r border-gray-200 overflow-hidden">

    <div class="bg-white px-4 py-3 border-b border-gray-200 flex justify-between items-center shadow-sm z-10">
      <div class="flex items-center gap-2">
        <el-icon :size="20" class="text-blue-600">
          <Tools />
        </el-icon>
        <span class="font-bold text-gray-800 text-lg">训练工作台</span>
      </div>

      <div class="flex items-center gap-3">
        <div class="flex items-center gap-2 mr-2 bg-blue-50 px-2 py-1 rounded border border-blue-100">
          <span class="text-xs text-blue-600 font-bold">无人值守模式</span>
          <el-switch v-model="isAutoMode" size="small" active-text="开" inactive-text="关" @change="toggleAutoMode" />
        </div>

        <el-button type="primary" plain size="small" :loading="isSyncing" @click="fetchCloudData(true)">
          <el-icon class="mr-1">
            <Download />
          </el-icon> 同步新数据
        </el-button>
        <el-tag :type="isTraining ? 'warning' : 'success'" effect="dark" round>
          {{ isTraining ? '正在训练...' : '系统就绪' }}
        </el-tag>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-4">

      <el-card shadow="hover" :body-style="{ padding: '15px' }">
        <el-row :gutter="20">
          <el-col :span="12">
            <el-statistic title="总样本数" :value="allDataset.length">
              <template #suffix>
                <el-icon style="vertical-align: -0.125em">
                  <Picture />
                </el-icon>
              </template>
            </el-statistic>
          </el-col>
          <el-col :span="12">
            <el-statistic title="分类数量" :value="uniqueLabels.length">
              <template #suffix>
                <el-icon style="vertical-align: -0.125em">
                  <PriceTag />
                </el-icon>
              </template>
            </el-statistic>
          </el-col>
        </el-row>
      </el-card>

      <el-card shadow="hover" class="data-card">
        <template #header>
          <div class="flex justify-between items-center">
            <span class="font-bold">数据录入</span>
            <el-button v-if="allDataset.length > 0" type="primary" link @click="loadData">
              <el-icon>
                <Refresh />
              </el-icon> 刷新列表
            </el-button>
          </div>
        </template>

        <div class="flex gap-2 mb-4">
          <el-input v-model="currentLabel" placeholder="输入标签 (如: cat)" clearable @keyup.enter="triggerUpload">
            <template #prepend>标签</template>
          </el-input>

          <el-upload ref="uploadRef" action="#" :auto-upload="false" :show-file-list="false"
            :on-change="handleFileChange" accept="image/*" multiple>
            <template #trigger>
              <el-button type="primary" :loading="isProcessingUpload" @click="checkLabelBeforeUpload">
                <el-icon class="el-icon--left">
                  <Upload />
                </el-icon>上传
              </el-button>
            </template>
          </el-upload>
        </div>

        <div v-if="uniqueLabels.length > 0" class="flex justify-between items-center mb-4 bg-gray-50 p-2 rounded">
          <div class="flex items-center gap-2">
            <span class="text-sm text-gray-500">筛选分类:</span>
            <el-select v-model="filterLabel" placeholder="全部显示" size="small" style="width: 140px" clearable>
              <el-option v-for="lbl in uniqueLabels" :key="lbl" :label="`${lbl} (${labelCounts[lbl]})`" :value="lbl" />
            </el-select>
          </div>
          <el-button v-if="filterLabel" type="danger" size="small" plain @click="deleteByLabel(filterLabel)">
            删除 {{ filterLabel }}
          </el-button>
        </div>

        <div class="image-grid-container h-36 overflow-y-auto pr-1">
          <div ref="listRef" class="grid grid-cols-5 gap-2" v-auto-animate>
            <div v-for="item in paginatedData" :key="item.id"
              class="relative group aspect-square border border-gray-200 rounded overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer">
              <el-image :src="item.image" class="w-full h-full" fit="cover" loading="lazy" />
              <div class="absolute inset-x-0 bottom-0 bg-black/60 p-1 text-center">
                <span class="text-xs text-white truncate block">{{ item.label }}</span>
              </div>
              <div
                class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <el-button type="danger" circle size="small" @click="deleteItem(item.id)">
                  <el-icon>
                    <Delete />
                  </el-icon>
                </el-button>
              </div>
            </div>

            <div v-if="paginatedData.length === 0" class="col-span-4 py-8 flex justify-center">
              <el-empty description="暂无数据" :image-size="60" />
            </div>
          </div>
        </div>

        <div class="mt-3 flex justify-center">
          <el-pagination v-if="filteredData.length > pageSize" small background layout="prev, pager, next"
            :total="filteredData.length" :page-size="pageSize" v-model:current-page="currentPage" />
        </div>
      </el-card>

      <el-card shadow="hover" :body-style="{ padding: '10px 20px' }">
        <template #header>
          <div class="flex justify-between items-center cursor-pointer" @click="showConfig = !showConfig">
            <span class="font-bold">训练参数</span>
            <el-icon :class="{ 'rotate-180': showConfig }" class="transition-transform duration-300">
              <ArrowDown />
            </el-icon>
          </div>
        </template>

        <el-collapse-transition>
          <div v-show="showConfig">
            <el-form label-position="top" size="small">
              <el-row :gutter="15">
                <el-col :span="12">
                  <el-form-item label="训练轮数 (Epochs)">
                    <el-input-number v-model="config.epochs" :min="1" :max="200" class="w-full" />
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="批次大小 (Batch Size)">
                    <el-input-number v-model="config.batchSize" :min="1" :max="128" class="w-full" />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="15">
                <el-col :span="12">
                  <el-form-item label="学习率 (Learning Rate)">
                    <el-select v-model="config.learningRate" placeholder="选择学习率" class="w-full">
                      <el-option label="0.01 (快速)" :value="0.01" />
                      <el-option label="0.001 (默认)" :value="0.001" />
                      <el-option label="0.0001 (微调)" :value="0.0001" />
                    </el-select>
                  </el-form-item>
                </el-col>
                <el-col :span="12">
                  <el-form-item label="验证集比例">
                    <div class="px-2 w-full">
                      <el-slider v-model="validationSplitPercent" :min="10" :max="40" :step="5" show-stops
                        :marks="{ 10: '10%', 20: '20%', 30: '30%', 40: '40%' }" />
                    </div>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-divider content-position="center">高级参数</el-divider>
              <el-row :gutter="15">
                <el-col :span="8">
                  <el-form-item label="神经元 (Units)">
                    <el-input-number v-model="config.denseUnits" :step="32" :min="32" :max="512" class="w-full" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="丢弃率 (Dropout)">
                    <el-input-number v-model="config.dropoutRate" :step="0.1" :min="0" :max="0.9" :precision="1"
                      class="w-full" />
                  </el-form-item>
                </el-col>
                <el-col :span="8">
                  <el-form-item label="L2 正则化">
                    <el-select v-model="config.l2Rate" class="w-full">
                      <el-option label="0 (关闭)" :value="0" />
                      <el-option label="0.001 (轻微)" :value="0.001" />
                      <el-option label="0.01 (适中)" :value="0.01" />
                      <el-option label="0.05 (强力)" :value="0.05" />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-form-item>
                <el-checkbox v-model="config.useIncremental" label="启用增量训练 (继承旧模型)" border class="w-full" />
              </el-form-item>
            </el-form>
          </div>
        </el-collapse-transition>
      </el-card>

    </div>

    <div
      class="bg-white border-t border-gray-200 p-4 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] flex-none flex flex-col min-h-[340px]">
      <div class="flex gap-2 mb-4">
        <el-button type="primary" size="large" class="flex-1 font-bold" :loading="isTraining"
          :disabled="allDataset.length < 2" @click="startTraining">
          {{ isTraining ? '服务器正在训练...' : '🚀 开始远程训练' }}
        </el-button>
      </div>
      <div class="flex flex-col gap-3 justify-center mb-3">
        <div class="flex justify-center gap-2 flex-wrap">
          <el-tag type="warning" effect="dark" size="large" class="font-bold">
            🏆 Best ValAcc: {{ (trainStatus.bestValAcc * 100).toFixed(1) }}%
          </el-tag>

          <el-tag type="success" effect="dark" size="large" class="font-bold">
            📈 Best Acc: {{ (trainStatus.bestAcc * 100).toFixed(1) }}%
          </el-tag>

          <el-tag type="info" effect="plain" size="large">
            📉 Loss: {{ (trainStatus.bestLoss || 0).toFixed(4) }}
          </el-tag>
          <el-tag type="info" effect="plain" size="large">
            📅 Epoch: {{ trainStatus.bestEpoch }}
          </el-tag>
        </div>
        <div v-if="trainStatus.epoch > 0" class="flex gap-4 justify-center animate-pulse">
          <el-tag type="info" effect="plain">Epoch: {{ trainStatus.epoch }} / {{ trainStatus.totalEpochs }}</el-tag>
          <el-tag type="danger" effect="plain">Loss: {{ trainStatus.loss.toFixed(4) }}</el-tag>
          <el-tag type="success" effect="plain">Acc: {{ (trainStatus.acc * 100).toFixed(1) }}%</el-tag>
          <el-tag v-if="trainStatus.val_acc" type="primary" effect="plain">Val: {{ (trainStatus.val_acc *
            100).toFixed(1)
          }}%</el-tag>
        </div>
      </div>

      <div class="flex-1 relative w-full border border-gray-100 rounded bg-gray-50 p-2 min-h-0">
        <canvas ref="chartCanvas"></canvas>
        <div v-if="!isTraining && !trainStatus.completed"
          class="absolute inset-0 flex items-center justify-center text-gray-300 pointer-events-none">
          <div class="text-center">
            <el-icon :size="40">
              <DataLine />
            </el-icon>
            <p class="text-xs mt-1">训练图表区域</p>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
import { compressImage } from '../utils/imageUtils';
import Chart from 'chart.js/auto';

// 环境变量支持
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api';

const currentLabel = ref('');
const allDataset = shallowRef([]);
const isTraining = ref(false);
const isProcessingUpload = ref(false);
const isSyncing = ref(false);

const filterLabel = ref('');
const currentPage = ref(1);
const pageSize = 12;
const showConfig = ref(true);

let chartInstance = null;
const chartCanvas = ref(null);
const uploadRef = ref(null);

const isAutoMode = ref(false);
let autoTrainTimer = null;


const config = ref({
  epochs: 20,
  batchSize: 16,
  validationSplit: 0.2,
  learningRate: 0.001,
  useIncremental: true,
  // 🌟 新增默认值
  denseUnits: 128,
  dropoutRate: 0.5,
  l2Rate: 0.01,
});
const validationSplitPercent = computed({
  get: () => Math.round(config.value.validationSplit * 100), // 0.2 -> 20
  set: (val) => {
    config.value.validationSplit = val / 100; // 20 -> 0.2
  }
});
watch(config, (newVal) => localStorage.setItem('training_config', JSON.stringify(newVal)), { deep: true });





// 状态：增加 totalEpochs 方便显示进度
const trainStatus = ref({
  epoch: 0, totalEpochs: 0, loss: 0, acc: 0, val_acc: undefined,
  bestValAcc: 0, bestEpoch: 0, bestLoss: 0, bestAcc: 0, // 🌟 增加 bestAcc
  completed: false
});

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

// 加载数据
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

// 同步新数据
const fetchCloudData = async (isManualClick = true) => {
  if (isSyncing.value || isTraining.value) return;

  isSyncing.value = true;
  try {
    const res = await fetch(`${API_BASE}/pending-data`);
    const json = await res.json();

    if (!json.success || json.data.length === 0) {
      if (isManualClick) ElMessage.info('暂无待训练数据');
      return;
    }

    const trainedIds = json.data.map(doc => doc._id);
    const count = trainedIds.length;

    await fetch(`${API_BASE}/mark-trained`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: trainedIds })
    });

    await loadData();

    if (isAutoMode.value) {
      ElNotification({
        title: '自动训练启动',
        message: `检测到 ${count} 条新数据，开始自动训练...`,
        type: 'success'
      });
      startTraining();
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

// 在 script setup 中添加一个单独的函数来获取一次状态
const fetchInitialStatus = async () => {
  try {
    const res = await fetch(`${API_BASE}/train/status`);
    const status = await res.json();

    // 只更新历史最佳数据，不更新 epoch/loss 等实时数据（除非正在训练）
    trainStatus.value.bestValAcc = status.bestValAcc || 0;
    trainStatus.value.bestEpoch = status.bestEpoch || 0;
    trainStatus.value.bestLoss = status.bestLoss || 0;
    trainStatus.value.bestAcc = status.bestAcc || 0;

    // 如果发现后端正在训练（比如刷新页面后），恢复训练状态
    if (status.isTraining) {
      isTraining.value = true;
      // 这里可以考虑重新启动 pollStatus 轮询，恢复图表
      // 但为了简单，只同步数据也行
    }
  } catch (e) {
    console.error('获取初始状态失败', e);
  }
};

// 上传
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
      allDataset.value = [json.data, ...allDataset.value];
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

// 删除
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
  } catch { }
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

const checkLabelBeforeUpload = () => { if (!currentLabel.value) return ElMessage.warning('请先输入标签名称'); };
const triggerUpload = () => { if (!currentLabel.value) return ElMessage.warning('请输入标签'); ElMessage.info('请点击上传按钮'); };

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

// 🌟🌟🌟 新的训练入口 (后端驱动) 🌟🌟🌟
const startTraining = async () => {
  if (allDataset.value.length < 2) return ElMessage.warning('样本不足');

  isTraining.value = true;

  // ✅ 修复：直接重置全局状态，而不是重新定义变量
  trainStatus.value = {
    epoch: 0, totalEpochs: config.value.epochs, loss: 0, acc: 0,
    val_acc: undefined, bestValAcc: 0, bestEpoch: 0, bestLoss: 0, bestAcc: 0,
    completed: false
  };

  initChart();

  try {
    // 1. 发送开始指令 (包含所有参数)
    const res = await fetch(`${API_BASE}/train`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config.value)
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    ElMessage.success('服务器已开始训练...');

    // 2. 开启轮询
    const pollStatus = async () => {
      if (!isTraining.value) return;

      try {
        const statusRes = await fetch(`${API_BASE}/train/status`);
        const status = await statusRes.json();

        // 🟢 状态同步
        if (typeof status.epoch === 'number') {
          // 更新全局响应式对象
          trainStatus.value = {
            epoch: status.epoch,
            totalEpochs: status.totalEpochs || config.value.epochs,
            loss: status.loss || 0,
            acc: status.acc || 0,
            val_acc: status.val_acc,
            bestValAcc: status.bestValAcc || 0,
            bestEpoch: status.bestEpoch || 0,
            bestLoss: status.bestLoss || 0,
            bestAcc: status.bestAcc || 0
          };

          // 更新图表 (使用全量历史数据，解决断层问题)
          if (chartInstance && status.history && status.history.length > 0) {
            chartInstance.data.labels = status.history.map(h => h.epoch);
            chartInstance.data.datasets[0].data = status.history.map(h => h.loss);
            chartInstance.data.datasets[1].data = status.history.map(h => h.acc);
            chartInstance.data.datasets[2].data = status.history.map(h => h.val_acc);
            chartInstance.update('none');
          }
        }

        // 🔴 错误处理
        if (status.phase === 'error') {
          throw new Error(status.error || '后端训练异常');
        }

        // 🔵 完成处理
        if (status.phase === 'complete') {
          isTraining.value = false;
          trainStatus.value.completed = true;
          // 最后一次刷新图表
          if (chartInstance) chartInstance.update();
          ElMessage.success(`训练完成！(共 ${status.epoch} 轮)`);
        } else {
          setTimeout(pollStatus, 1000);
        }

      } catch (err) {
        isTraining.value = false;
        if (err.name !== 'AbortError') {
          ElMessage.error('获取状态失败: ' + err.message);
        }
      }
    };

    setTimeout(pollStatus, 1000);

  } catch (err) {
    isTraining.value = false;
    ElMessage.error('启动训练失败: ' + err.message);
  }
};

onUnmounted(() => {
  if (chartInstance) chartInstance.destroy();
  if (autoTrainTimer) clearInterval(autoTrainTimer);
  isTraining.value = false;
});

onMounted(async () => {
  await loadData();
  await fetchInitialStatus();
  nextTick(() => initChart());
});
</script>

<style scoped>
.image-grid-container::-webkit-scrollbar {
  width: 6px;
}

.image-grid-container::-webkit-scrollbar-thumb {
  background: #dcdfe6;
  border-radius: 4px;
}
</style>