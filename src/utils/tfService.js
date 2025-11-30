import * as tf from '@tensorflow/tfjs';
// 显式导入 WebGL 后端，确保在浏览器中使用 GPU 加速
import '@tensorflow/tfjs-backend-webgl';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { loadImageFromBase64 } from './imageUtils';

/**
 * TFService: 核心 AI 服务类
 * 负责管理 TensorFlow.js 的生命周期。
 * * ⚠️ 关于数据库的说明：
 * 本服务中的 'indexeddb://' 仅用于 TensorFlow.js 内部缓存模型文件（加速加载），
 * 与业务数据（图片、标签）的存储位置（NeDB/后端）无关。
 */
class TFService {
  constructor() {
    this.mobilenetModel = null;
    this.classifierModel = null;
    this.labels = [];

    // 🌟 1. 定义模型地址池 (优先级从高到低)
    this.modelUrls = [
      // 优先级 1: 本地文件 (最快、最稳，强烈推荐您下载文件到 public/models 目录)
      'models/model.json',

      // 优先级 2: tfhub.dev 的官方镜像 (国内访问较慢但稳定)
      'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1',

      // 优先级 3: Google Storage (原始地址，国内可能被墙)
      'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json',

      // 优先级 4: JsDelivr CDN (尝试通过 npm 包路径加载)
      'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.0/dist/mobilenet.min.js'
    ];

    // 定义浏览器本地缓存的键名 (仅用于缓存模型文件)
    this.dbModelPath = 'indexeddb://mobilenet-v2-cached';

    // 在类实例化时立即尝试初始化 WebGL 后端
    this.initBackend();
  }

  /**
   * 辅助函数：Fisher-Yates 洗牌算法
   * 作用：随机打乱数组顺序。防止验证集切分不均。
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * 初始化并检查 TensorFlow 后端
   */
  async initBackend() {
    try {
      await tf.setBackend('webgl');
      const backend = tf.getBackend();
      console.log(`当前 TensorFlow.js 后端: ${backend} ✅`);

      // 显存预热
      tf.tidy(() => {
        const a = tf.tensor([1, 2, 3, 4]);
        a.square().dispose();
      });
    } catch (error) {
      console.error('初始化 WebGL 失败，尝试降级到 CPU:', error);
      try {
        await tf.setBackend('cpu');
      } catch (cpuError) {
        console.error('严重错误：无法初始化任何后端。', cpuError);
      }
    }
  }

  /**
   * 🌟 核心：带重试和超时机制的模型加载器
   */
  async loadModelWithFallback() {
    for (const url of this.modelUrls) {
      try {
        console.log(`🔄 尝试加载模型: ${url}`);
        const loadPromise = mobilenet.load({
          version: 2,
          alpha: 1.0,
          modelUrl: url
        });
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), 8000)
        );
        const model = await Promise.race([loadPromise, timeoutPromise]);
        console.log(`✅ 成功从 [${url}] 加载模型!`);
        return model;
      } catch (err) {
        console.warn(`❌ 从 [${url}] 加载失败或超时，尝试下一个...`, err.message);
      }
    }
    throw new Error("😱 所有模型源均加载失败！请检查网络或部署本地模型文件。");
  }

  /**
   * 加载 MobileNet 基础模型 (特征提取器)
   */
  async loadBaseModel() {
    if (tf.getBackend() !== 'webgl' && tf.getBackend() !== 'cpu') {
      await this.initBackend();
    }

    if (this.mobilenetModel) return true;

    try {
      console.log('正在初始化 MobileNet...');

      // 1. 优先尝试从 IndexDB 缓存加载 (极速)
      try {
        this.mobilenetModel = await mobilenet.load({
          version: 2,
          alpha: 1.0,
          modelUrl: this.dbModelPath
        });
        console.log('🚀 本地缓存命中！(IndexedDB)');
      } catch (cacheError) {
        // 2. 缓存未命中，启动多源回退下载
        console.log(`📦 本地无缓存，开始多源下载...`);
        this.mobilenetModel = await this.loadModelWithFallback();
        console.log('MobileNet 网络下载成功 ✅');

        // 3. 下载成功后，自动保存到 IndexDB 供下次使用
        try {
          if (this.mobilenetModel && this.mobilenetModel.model) {
            await this.mobilenetModel.model.save(this.dbModelPath);
            console.log('💾 模型已缓存到 IndexedDB。');
          }
        } catch (saveErr) {
          console.warn('模型缓存写入失败:', saveErr);
        }
      }

      // 预热模型
      tf.tidy(() => {
        const warmUpTensor = tf.zeros([1, 224, 224, 3], 'float32');
        this.mobilenetModel.infer(warmUpTensor, true);
      });
      return true;

    } catch (error) {
      console.error('致命错误: 模型加载失败', error);
      throw error;
    }
  }

  /**
   * 🚀 核心训练方法
   * @param {Array} rawData - 这里接收的数据可以来自 API (URL) 或 Base64
   */
  async train(rawData, config, callbacks = {}) {
    if (!this.mobilenetModel) await this.loadBaseModel();

    const { onEpochEnd, onBatchProcess } = callbacks;
    const { epochs = 20, batchSize = 16, validationSplit = 0.1, learningRate = 0.001, useIncremental = false } = config;

    // --- 步骤 1: 数据洗牌 ---
    const shuffledData = this.shuffleArray([...rawData]);
    const labels = shuffledData.map(item => item.label);
    const uniqueLabels = [...new Set(labels)].sort();

    if (uniqueLabels.length < 2) throw new Error("训练失败：至少需要 2 个不同的分类才能开始训练。");
    this.labels = uniqueLabels;
    console.log(`开始处理 ${shuffledData.length} 张图片，共 ${uniqueLabels.length} 个分类`);

    // --- 步骤 2: 准备标签张量 (Y) ---
    let ys;
    try {
      ys = tf.tidy(() => tf.oneHot(
        tf.tensor1d(labels.map(l => uniqueLabels.indexOf(l)), 'int32'),
        uniqueLabels.length
      ));
    } catch (e) { throw new Error("标签处理失败: " + e.message); }

    // --- 步骤 3: 分批特征提取 (X) ---
    const BATCH_SIZE = 50;
    const featureTensors = [];
    let xs;

    try {
      for (let i = 0; i < shuffledData.length; i += BATCH_SIZE) {
        const end = Math.min(i + BATCH_SIZE, shuffledData.length);
        if (onBatchProcess) onBatchProcess(i, shuffledData.length);

        const batchData = shuffledData.slice(i, end);
        // 🌟 这里会调用 imageUtils 里的 loadImageFromBase64
        // 它同时支持 Base64 和 URL (http://localhost:3000/uploads/xxx.jpg)
        const batchImages = await Promise.all(batchData.map(item => loadImageFromBase64(item.image)));

        const batchFeatures = tf.tidy(() => {
          const tensors = batchImages.map(img => {
            let t = tf.browser.fromPixels(img).toFloat();
            // 简单数据增强：随机翻转
            if (Math.random() > 0.5) {
              // expandDims(0): [H, W, C] -> [1, H, W, C]
              const batched = t.expandDims(0);
              const flipped = tf.image.flipLeftRight(batched);

              // 释放原有的 t 和临时的 batched，保留 flipped
              // 注意：如果是 t 本身也是临时生成的，最好让它在 tidy 内部自动处理
              // 但因为这里 t 变量被复用，我们可以这样写：

              // squeeze(0): [1, H, W, C] -> [H, W, C]
              const result = flipped.squeeze(0);

              // 清理中间变量 (tf.tidy 会自动做，但为了逻辑严谨)
              // 如果你在外面套了 tf.tidy，这些 dispose 其实可以省略
              // 但为了安全起见，最简单的写法是用 tidy 包裹这段小逻辑
              t = result;
            }
            return this.mobilenetModel.infer(t, true);
          });
          return tf.concat(tensors);
        });

        featureTensors.push(batchFeatures);
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      xs = tf.concat(featureTensors);
      if (onBatchProcess) onBatchProcess(shuffledData.length, shuffledData.length);
    } catch (error) {
      featureTensors.forEach(t => t.dispose());
      if (ys) ys.dispose();
      throw error;
    } finally {
      featureTensors.forEach(t => !t.isDisposed && t.dispose());
    }

    // --- 步骤 4: 构建分类模型 ---
    const featureSize = xs.shape[1];
    let modelToTrain = null;

    // 尝试加载增量模型 (从浏览器缓存)
    if (useIncremental) {
      try {
        const oldModel = await tf.loadLayersModel('indexeddb://my-custom-model');
        const oldLabels = JSON.parse(localStorage.getItem('model_labels') || '[]');
        if (oldModel && JSON.stringify(oldLabels.sort()) === JSON.stringify(uniqueLabels)) {
          console.log("增量模式: 加载旧模型✅");
          modelToTrain = oldModel;
        } else {
          if (oldModel) oldModel.dispose();
        }
      } catch (e) { /* ignore */ }
    }

    if (!modelToTrain) {
      modelToTrain = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [featureSize],
            units: 128,
            activation: 'relu',
            kernelInitializer: 'varianceScaling'
          }),
          tf.layers.dropout({ rate: 0.4 }),
          tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' })
        ]
      });
    }

    this.classifierModel = modelToTrain;

    this.classifierModel.compile({
      optimizer: tf.train.adam(learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    // --- 步骤 5: 开始拟合 ---
    try {
      console.log('开始训练...');
      await this.classifierModel.fit(xs, ys, {
        epochs: epochs,
        batchSize: batchSize,
        validationSplit: validationSplit,
        shuffle: true,
        callbacks: {
          onEpochEnd: (epoch, logs) => { if (onEpochEnd) onEpochEnd(epoch, logs); }
        }
      });

      // 🌟 训练完成后，依然保存到浏览器的 IndexedDB 缓存中，以便 predict 时快速调用
      // 这不影响后端 NeDB 里的数据存储
      await this.classifierModel.save('indexeddb://my-custom-model');
      localStorage.setItem('model_labels', JSON.stringify(this.labels));
      return true;
    } catch (trainError) {
      console.error("训练过程出错:", trainError);
      throw trainError;
    } finally {
      console.log("清理训练张量...");
      if (xs && !xs.isDisposed) xs.dispose();
      if (ys && !ys.isDisposed) ys.dispose();
    }
  }

  async predict(imgElement) {
    if (!this.classifierModel) {
      try {
        this.classifierModel = await tf.loadLayersModel('indexeddb://my-custom-model');
        this.labels = JSON.parse(localStorage.getItem('model_labels') || '[]');
      } catch (e) { throw new Error("模型尚未训练，请先完成训练。"); }
    }
    if (!this.mobilenetModel) await this.loadBaseModel();
    if (tf.getBackend() !== 'webgl' && tf.getBackend() !== 'cpu') await this.initBackend();

    return tf.tidy(() => {
      const imgTensor = tf.browser.fromPixels(imgElement).toFloat();
      const activation = this.mobilenetModel.infer(imgTensor, true);
      const prediction = this.classifierModel.predict(activation);
      const values = prediction.dataSync();
      return Array.from(values).map((v, i) => ({ label: this.labels[i], score: v })).sort((a, b) => b.score - a.score);
    });
  }
}

export const tfService = new TFService();