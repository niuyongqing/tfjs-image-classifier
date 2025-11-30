const tf = require('@tensorflow/tfjs-node');
const mobilenet = require('@tensorflow-models/mobilenet');
const path = require('path');
const fs = require('fs');
const Datastore = require('nedb-promises');

// 配置路径
const DB_PATH = path.join(__dirname, 'data.db');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const MODEL_SAVE_DIR = path.join(__dirname, 'public', 'current-model');
// MobileNet 本地路径 (为了稳定，建议用本地的，如果没有就用在线的)
// 这里我们假设你已经把前端那个 public/models/model.json 拷贝了一份到 server/public/models/ 下
// 或者直接使用在线 URL 也可以，Node 环境访问 Google 同样需要网络通畅
const BASE_MODEL_URL = 'https://storage.googleapis.com/tfjs-models/savedmodel/mobilenet_v2_1.0_224/model.json';

// 初始化数据库连接
const db = Datastore.create({ filename: DB_PATH, autoload: true });

class BackendTrainer {
  constructor() {
    this.mobilenetModel = null;
    this.classifierModel = null;
    this.isTraining = false;
  }

  async loadBaseModel() {
    if (this.mobilenetModel) return;
    console.log('⏳ 正在加载 MobileNet 基础模型...');
    // 在 Node 环境下，mobilenet 库会自动使用 tfjs-node
    this.mobilenetModel = await mobilenet.load({
      version: 2,
      alpha: 1.0,
      modelUrl: BASE_MODEL_URL
    });
    console.log('✅ MobileNet 加载完成');
  }

  // 辅助：读取图片并转为 Tensor
  async imageToTensor(filename) {
    const imagePath = path.join(UPLOAD_DIR, path.basename(filename));
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      // tf.node.decodeImage 解码图片为 Tensor3D
      const tfimage = tf.node.decodeImage(imageBuffer, 3);
      return tfimage;
    } catch (e) {
      console.error(`无法读取图片: ${imagePath}`, e.message);
      return null;
    }
  }

  async startTraining() {
    if (this.isTraining) {
      console.log('⚠️ 训练正在进行中，跳过本次请求');
      return;
    }
    this.isTraining = true;
    console.log('🚀 开始后台自动训练流程...');

    try {
      // 1. 从数据库获取所有数据 (或者只获取 pending + trained)
      // 这里我们获取所有数据作为全量训练，保证模型不会遗忘旧知识
      const allDocs = await db.find({}); // 也可以加查询条件
      if (allDocs.length < 2) {
        console.log('📉 数据样本不足 2 个，取消训练');
        return;
      }

      await this.loadBaseModel();

      // 2. 准备数据
      const inputs = [];
      const labels = [];
      const labelSet = new Set();

      console.log(`📦 正在处理 ${allDocs.length} 条样本...`);
      
      for (const doc of allDocs) {
        if (!doc.imageUrl || !doc.label) continue;
        
        const tensor = await this.imageToTensor(doc.imageUrl);
        if (tensor) {
          // 提取特征 (Feature Extraction)
          const activation = this.mobilenetModel.infer(tensor, true);
          inputs.push(activation);
          labels.push(doc.label);
          labelSet.add(doc.label);
          tensor.dispose(); // 释放原始图片内存
        }
      }

      if (inputs.length === 0) throw new Error('有效样本为 0');

      // 3. 构建 Tensor 数据集
      const uniqueLabels = Array.from(labelSet).sort();
      console.log('🏷️  检测到分类:', uniqueLabels);

      const xs = tf.concat(inputs);
      const ys = tf.tidy(() => {
        return tf.oneHot(
          tf.tensor1d(labels.map(l => uniqueLabels.indexOf(l)), 'int32'),
          uniqueLabels.length
        );
      });

      // 4. 定义分类模型 (与前端保持一致)
      const model = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [1024], // MobileNetV2 输出特征维度
            units: 128,
            activation: 'relu',
            kernelInitializer: 'varianceScaling'
          }),
          tf.layers.dropout({ rate: 0.4 }),
          tf.layers.dense({
            units: uniqueLabels.length,
            activation: 'softmax'
          })
        ]
      });

      model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
      });

      // 5. 训练
      console.log('🔥 模型拟合中 (Epochs: 20)...');
      await model.fit(xs, ys, {
        epochs: 20,
        batchSize: 16,
        shuffle: true,
        verbose: 0 // 不在控制台刷屏日志
      });

      // 6. 保存模型到本地文件系统
      // file:// 协议会把模型保存到指定文件夹
      if (!fs.existsSync(MODEL_SAVE_DIR)) fs.mkdirSync(MODEL_SAVE_DIR, { recursive: true });
      
      await model.save(`file://${MODEL_SAVE_DIR}`);
      
      // 保存标签文件 (前端预测需要)
      fs.writeFileSync(path.join(MODEL_SAVE_DIR, 'labels.json'), JSON.stringify(uniqueLabels));

      // 7. 更新数据库状态
      // 把所有 'pending' 的数据标记为 'trained'
      await db.update({ status: 'pending' }, { $set: { status: 'trained' } }, { multi: true });

      console.log('💾 模型训练完成并已保存至 server/public/current-model');
      
      // 清理内存
      xs.dispose();
      ys.dispose();
      model.dispose();

    } catch (error) {
      console.error('❌ 训练失败:', error);
    } finally {
      this.isTraining = false;
    }
  }
}

// 导出单例
module.exports = new BackendTrainer();