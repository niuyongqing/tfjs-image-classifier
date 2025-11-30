const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
// const Datastore = require('nedb-promises');
const multer = require('multer');
const trainService = require('./src/utils/trainService');
// 🌟 [新增] 引入 TFJS 和 MobileNet
const tf = require('@tensorflow/tfjs-node');
const mobilenet = require('@tensorflow-models/mobilenet');

// 👇👇👇 [修改 1] 定义新的 DB 目录 👇👇👇
const DB_DIR = path.join(__dirname, 'db');
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const MODEL_DIR = path.join(__dirname, 'public', 'current-model');

// 👇👇👇 [修改 2] 确保 DB 目录存在 (加入 DB_DIR) 👇👇👇
[UPLOAD_DIR, MODEL_DIR, DB_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 初始化数据库
const db = require('./src/utils/db');
// 确保目录存在
[UPLOAD_DIR, MODEL_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(cors());
// 增加 body 大小限制，防止图片过大无法上传
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// 开放静态资源
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/model', express.static(MODEL_DIR));

// =================================================================
// 🌟 AI 核心模块 (后端推理引擎)
// =================================================================
let baseModel = null;      // MobileNet (特征提取器)
let classifierModel = null; // 你的自定义模型 (分类头)
let modelLabels = [];      // 标签列表

// 初始化 AI 模型
async function initAI() {
  try {
    console.log('⏳ 正在加载 MobileNet 基础模型 (离线模式)...');

    // 👇 1. 拼接本地模型文件的绝对路径
    const localBaseModelPath = path.join(__dirname, 'public', 'mobilenet_base', 'model.json');

    // 👇 2. 检查一下文件到底有没有复制对
    if (!fs.existsSync(localBaseModelPath)) {
      console.error(`❌ 错误：找不到文件 ${localBaseModelPath}`);
      console.error('请务必从前端 public/models 复制文件到 server/public/mobilenet_base 目录！');
      return;
    }

    // 👇 3. 加载模型 (注意这里加了 file:// 前缀)
    baseModel = await mobilenet.load({
      version: 2,
      alpha: 1.0,
      modelUrl: `file://${localBaseModelPath}` // 🌟 关键：强制读本地，不联网
    });
    console.log('✅ MobileNet 基础模型加载完成 (本地离线)');

    console.log('⏳ 正在加载自定义分类模型...');
    const modelJsonPath = path.join(MODEL_DIR, 'model.json');
    const labelsPath = path.join(MODEL_DIR, 'labels.json');

    if (fs.existsSync(modelJsonPath) && fs.existsSync(labelsPath)) {
      // 加载你发布到后端的模型
      // 注意：tfjs-node 加载本地模型需要使用 file:// 协议
      classifierModel = await tf.loadLayersModel(`file://${modelJsonPath}`);

      // 加载标签
      const labelsData = fs.readFileSync(labelsPath, 'utf-8');
      modelLabels = JSON.parse(labelsData);

      console.log(`✅ 自定义模型加载完成 (分类: ${modelLabels.join(', ')})`);
    } else {
      console.warn('⚠️ 未找到自定义模型文件，请先在前端完成训练并发布模型。');
    }
  } catch (error) {
    console.error('❌ AI 模型初始化失败:', error.message);
  }
}

// 启动服务前先初始化 AI
initAI();
// 🌟 1. 触发训练 API
app.post('/api/train', async (req, res) => {
  try {
    trainService.startTraining(req.body).catch(err => console.error("后台训练出错:", err));

    res.json({ success: true, message: '训练指令已发送' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// 🌟 2. 查询训练状态 API (前端轮询用)
app.get('/api/train/status', (req, res) => {
  res.json(trainService.getStatus());
});
// =================================================================
// 🌟 新增接口: 图像识别 API
// body{
//     "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABA......"
// }
// response{
//     "label": "cat",
//     "score": 0.98234
// }
// =================================================================
app.post('/api/predict', async (req, res) => {
  try {
    const { image } = req.body; // 接收 base64 字符串

    if (!baseModel || !classifierModel) {
      return res.status(503).json({ error: '模型服务尚未就绪或未发布模型' });
    }
    if (!image) {
      return res.status(400).json({ error: '请提供 image 参数 (Base64)' });
    }

    // 1. 处理 Base64 图片 -> Tensor
    // 去掉 base64 头部 (data:image/jpeg;base64,...)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const imgBuffer = Buffer.from(base64Data, 'base64');

    // 解码图片 (tf.node.decodeImage 支持 jpg/png)
    // 3 表示强制转为 RGB 3通道
    const imgTensor = tf.node.decodeImage(imgBuffer, 3);

    // 2. 推理流程 (与前端 tfService.js 逻辑一致)
    const result = tf.tidy(() => {
      // (1) 使用 MobileNet 提取特征 (Input -> Embeddings)
      // infer 方法内部会自动处理 resize 和 normalization
      const activation = baseModel.infer(imgTensor, true);

      // (2) 使用你的模型进行分类 (Embeddings -> Softmax)
      const predictions = classifierModel.predict(activation);

      // (3) 获取数据
      return predictions.dataSync();
    });

    // 3. 格式化结果
    // 将概率数组转换为 { label, score } 对象数组并排序
    const topResults = Array.from(result)
      .map((score, i) => ({ label: modelLabels[i], score: score }))
      .sort((a, b) => b.score - a.score);

    // 释放图片内存
    imgTensor.dispose();

    // 返回置信度最高的结果
    const bestResult = topResults[0];
    res.json(bestResult);

  } catch (error) {
    console.error('推理出错:', error);
    res.status(500).json({ error: '推理失败: ' + error.message });
  }
});

// ... (以下是原有的 dataset 相关的 API，保持不变) ...

app.get('/api/dataset', async (req, res) => {
  // ... 原有代码 ...
  try {
    const docs = await db.find({}).sort({ createdAt: -1 });
    const fullDocs = docs.map(doc => ({
      ...doc,
      id: doc._id,
      image: `http://localhost:3000${doc.imageUrl}`
    }));
    res.json({ success: true, data: fullDocs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dataset', async (req, res) => {
  try {
    const { image, label } = req.body;
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const fileName = `${uuidv4()}.jpg`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    const doc = {
      imageUrl: `/uploads/${fileName}`,
      label: label,
      createdAt: new Date(),
      status: 'active'
    };
    const newDoc = await db.insert(doc);
    res.json({ success: true, data: { ...newDoc, id: newDoc._id, image: `http://localhost:3000${newDoc.imageUrl}` } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/dataset/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await db.findOne({ _id: id });
    if (doc) {
      try {
        const filePath = path.join(__dirname, 'public', doc.imageUrl);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (e) { console.error("文件删除失败", e); }
    }
    await db.remove({ _id: id }, {});
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/dataset/label/:label', async (req, res) => {
  try {
    await db.remove({ label: req.params.label }, { multi: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/pending-data', async (req, res) => {
  try {
    const docs = await db.find({ status: 'pending' }).sort({ createdAt: 1 });
    res.json({ success: true, data: docs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/mark-trained', async (req, res) => {
  try {
    const { ids } = req.body;
    if (ids && ids.length > 0) {
      await db.update({ _id: { $in: ids } }, { $set: { status: 'trained' } }, { multi: true });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/upload-sample', async (req, res) => {
  try {
    const { image, label, confidence } = req.body;
    if (!image || !label) return res.status(400).json({ success: false, message: '缺少参数' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const fileName = `${uuidv4()}.jpg`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), Buffer.from(base64Data, 'base64'));

    const doc = {
      imageUrl: `/uploads/${fileName}`,
      label: label,
      status: 'pending', // 重点：标记为 pending，等待训练
      confidence_at_capture: confidence || 0,
      createdAt: new Date()
    };
    await db.insert(doc);
    res.json({ success: true, message: '样本已保存' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

const modelUpload = multer({
  storage: multer.diskStorage({
    destination: MODEL_DIR,
    filename: (req, f, cb) => cb(null, f.originalname)
  })
});
app.post('/api/upload-model', modelUpload.any(), (req, res) => {
  // 🌟 这里加一个触发器，如果收到新模型，重新加载内存中的模型
  res.json({ success: true });
  // 延迟 1 秒让文件写完后重新加载
  setTimeout(() => initAI(), 1000);
});

app.post('/api/upload-labels', async (req, res) => {
  fs.writeFileSync(path.join(MODEL_DIR, 'labels.json'), JSON.stringify(req.body.labels));
  res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ 数据中心服务已启动: http://localhost:${PORT}`);
});