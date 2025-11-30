<template>
  <div class="h-full flex flex-col bg-white overflow-y-auto">
    <!-- 顶部 -->
    <div class="bg-white px-4 py-3 border-b border-gray-200 flex items-center gap-2 shadow-sm z-10">
      <el-icon :size="20" class="text-purple-600">
        <VideoPlay />
      </el-icon>
      <span class="font-bold text-gray-800 text-lg">推理与数据录入</span>
    </div>

    <div class="p-6 flex-1 flex flex-col items-center">

      <!-- 1. 图片上传区 -->
      <div class="w-full max-w-lg">
        <el-upload class="upload-demo" drag action="#" :auto-upload="false" :show-file-list="false"
          :on-change="handleFile" accept="image/*">
          <div v-if="!previewImage" class="py-10">
            <el-icon class="el-icon--upload" :size="60"><upload-filled /></el-icon>
            <div class="el-upload__text">
              拖拽图片到此处 或 <em>点击上传</em>
            </div>
          </div>

          <div v-else
            class="relative w-full h-64 flex items-center justify-center bg-gray-50 border rounded-lg overflow-hidden">
            <img ref="imgRef" :src="previewImage" class="max-w-full max-h-full object-contain" @load="onImageLoad" />
            <!-- 重置按钮 -->
            <div class="absolute top-2 right-2" @click.stop>
              <el-button type="info" circle size="small" @click="reset">
                <el-icon>
                  <RefreshRight />
                </el-icon>
              </el-button>
            </div>
          </div>
        </el-upload>
      </div>

      <!-- 2. 结果确认与表单提交区 -->
      <div class="w-full max-w-lg mt-8 transition-all duration-500" v-if="previewImage">

        <div v-if="isLoading" class="text-center py-8">
          <el-skeleton animated>
            <template #template>
              <div class="p-4 space-y-4">
                <el-skeleton-item variant="h3" style="width: 50%" />
                <el-skeleton-item variant="rect" style="height: 40px" />
              </div>
            </template>
          </el-skeleton>
          <p class="text-gray-400 mt-2 text-sm">AI 正在分析...</p>
        </div>

        <div v-else class="animate-fade-in border border-gray-100 rounded-xl p-6 shadow-sm bg-white">

          <!-- AI 原始结果展示 (仅供参考) -->
          <div class="mb-6 flex items-center justify-between">
            <div>
              <h3 class="text-sm text-gray-500 font-medium">AI 识别结果</h3>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-lg font-bold text-gray-800">
                  {{ aiResult ? aiResult.label : '未识别' }}
                </span>
                <el-tag v-if="aiResult" :type="aiResult.score > 0.7 ? 'success' : 'warning'" size="small" effect="dark">
                  置信度: {{ (aiResult.score * 100).toFixed(0) }}%
                </el-tag>
              </div>
            </div>
            <!-- 只有高置信度才显示绿色勾勾 -->
            <el-icon v-if="aiResult && aiResult.score > 0.7" class="text-green-500" :size="32">
              <CircleCheckFilled />
            </el-icon>
            <el-icon v-else class="text-orange-400" :size="32">
              <QuestionFilled />
            </el-icon>
          </div>

          <el-divider border-style="dashed" />

          <!-- 表单区域 -->
          <el-form label-position="top" size="large">
            <el-form-item label="最终确认分类 (Label)">
              <el-select v-model="finalLabel" placeholder="请选择或输入正确分类" class="w-full" filterable allow-create
                default-first-option @change="handleUserChange" clearable>
                <el-option v-for="label in availableLabels" :key="label" :label="label" :value="label" />
              </el-select>
              <div class="text-xs text-gray-400 mt-1 h-4">
                <span v-if="isManualAction" class="text-orange-500 flex items-center gap-1">
                  <el-icon>
                    <Edit />
                  </el-icon> 检测到人工修正，保存时将上传样本用于训练
                </span>
                <span v-else-if="aiResult && aiResult.score > 0.7" class="text-green-600 flex items-center gap-1">
                  <el-icon>
                    <Check />
                  </el-icon> AI 识别可信，直接保存即可
                </span>
                <span v-else class="text-gray-400">
                  AI 置信度低，请手动选择正确分类
                </span>
              </div>
            </el-form-item>

            <el-button type="primary" class="w-full font-bold mt-2" :disabled="!finalLabel" :loading="isUploading"
              @click="submitForm">
              {{ isManualAction ? '保存并上传样本 (纠错)' : '确认结果 (不上传)' }}
            </el-button>
          </el-form>

        </div>
      </div>

      <!-- 空状态 -->
      <div v-if="!previewImage && !isLoading" class="flex-1 flex items-center justify-center text-gray-300">
        <div class="text-center">
          <el-icon :size="48">
            <Picture />
          </el-icon>
          <p class="mt-2 text-sm">等待图片上传</p>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
const previewImage = ref(null);
const imgRef = ref(null);
const isLoading = ref(false);

// AI 结果
const aiResult = ref(null);
// 用户表单数据
const finalLabel = ref('');
const availableLabels = ref([]);
// 状态标记
const isManualAction = ref(false); // 标记用户是否手动操作过
const isUploading = ref(false);

// 加载已有标签
onMounted(() => {
  const savedLabels = localStorage.getItem('model_labels');
  if (savedLabels) {
    try {
      availableLabels.value = JSON.parse(savedLabels);
    } catch (e) { console.error(e); }
  }
});

const reset = () => {
  previewImage.value = null;
  aiResult.value = null;
  finalLabel.value = '';
  isManualAction.value = false;
};

const handleFile = (uploadFile) => {
  const file = uploadFile.raw;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    previewImage.value = ev.target.result;
    // 重置状态
    aiResult.value = null;
    finalLabel.value = '';
    isManualAction.value = false;
  };
  reader.readAsDataURL(file);
};


// 图片加载完毕后 -> 发送给后端推理
const onImageLoad = async () => {
  if (!imgRef.value || !previewImage.value) return;

  isLoading.value = true;
  aiResult.value = null; // 清空旧结果

  try {
    // 🌟 核心变化：发送 HTTP 请求给后端
    const response = await fetch('http://localhost:3000/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: previewImage.value }) // 发送 Base64
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || '推理请求失败');
    }

    // 后端直接返回了最佳结果对象 { label: 'cat', score: 0.98 }
    aiResult.value = result;

    // 🌟 自动回显逻辑 (保持不变)
    if (result.score > 0.7) {
      finalLabel.value = result.label;
      isManualAction.value = false;
    } else {
      finalLabel.value = '';
    }

  } catch (e) {
    console.error(e);
    ElMessage.error('AI 识别失败: ' + e.message);
  } finally {
    isLoading.value = false;
  }
};

// 🌟 监听用户手动选择行为
const handleUserChange = (val) => {
  // 只要下拉框触发了 change 事件，就认为是人工干预了
  // 无论是从空变有，还是修改了 AI 的预填值
  isManualAction.value = true;
};

// 🌟 提交表单
const submitForm = async () => {
  if (!finalLabel.value) return;

  // 场景 1: AI 识别准 (>70%) 且 用户没改 -> 不上传，直接结束
  if (!isManualAction.value && aiResult.value && aiResult.value.score > 0.7) {
    ElMessage.success('结果已确认 (AI 识别准确，无需采样)');
    return;
  }

  // 场景 2: 用户有过手动选择行为 (包括 AI 不准导致的手动选择，或 AI 准但用户硬要改) -> 上传
  if (isManualAction.value) {
    await uploadSample();
  }
};

const uploadSample = async () => {
  isUploading.value = true;
  try {
    const payload = {
      image: previewImage.value,
      label: finalLabel.value,
      // 记录一下当时的 AI 得分，方便后续分析（如果当时没结果就是 0）
      confidence: aiResult.value ? aiResult.value.score : 0
    };

    const response = await fetch('http://localhost:3000/api/upload-sample', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (data.success) {
      ElMessage.success(`已上传 "${finalLabel.value}" 样本用于训练`);
      // 可选：上传后是否清空？这里不清空，方便用户看
    } else {
      throw new Error(data.message);
    }
  } catch (err) {
    console.error(err);
    ElMessage.error('上传失败: ' + err.message);
  } finally {
    isUploading.value = false;
  }
};
</script>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.5s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>