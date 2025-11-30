const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Datastore = require('nedb-promises');
const multer = require('multer');
// const tf = require('@tensorflow/tfjs-node'); // 如果安装失败可注释掉

// 初始化数据库
const db = Datastore.create({ filename: path.join(__dirname, 'data.db'), autoload: true });

// 图片目录
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
const MODEL_DIR = path.join(__dirname, 'public', 'current-model'); // 模型目录



// 确保目录存在
[UPLOAD_DIR, MODEL_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// 🌟 开放静态资源，让前端能访问图片
app.use('/uploads', express.static(UPLOAD_DIR));

// 🌟 【新增】开放模型目录，这样前端才能通过 URL 下载 model.json
app.use('/model', express.static(MODEL_DIR));

// =================================================================
// 🌟 1. 获取数据集 (替代 IndexedDB.toArray)
// =================================================================
app.get('/api/dataset', async (req, res) => {
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

// =================================================================
// 🌟 2. 上传/添加新样本 (替代 IndexedDB.add)
// =================================================================
app.post('/api/dataset', async (req, res) => {
  try {
    const { image, label } = req.body;

    // 保存图片文件
    const base64Data = image.replace(/^data:image\/\w+;base64,/, "");
    const fileName = `${uuidv4()}.jpg`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));

    // 存入数据库
    const doc = {
      imageUrl: `/uploads/${fileName}`,
      label: label,
      createdAt: new Date(),
      status: 'active' // 标记为有效样本
    };

    const newDoc = await db.insert(doc);

    res.json({
      success: true,
      data: { ...newDoc, id: newDoc._id, image: `http://localhost:3000${newDoc.imageUrl}` }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =================================================================
// 🌟 3. 删除样本 (替代 IndexedDB.delete)
// =================================================================
app.delete('/api/dataset/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await db.findOne({ _id: id });
    if (doc) {
      try {
        // 删除文件 (注意路径拼接)
        // doc.imageUrl 是 /uploads/xxx.jpg
        // path.join(__dirname, 'public', doc.imageUrl) -> server/public/uploads/xxx.jpg
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

// =================================================================
// 🌟 4. 批量删除分类
// =================================================================
app.delete('/api/dataset/label/:label', async (req, res) => {
  try {
    await db.remove({ label: req.params.label }, { multi: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =================================================================
// 🌟 5. 获取"待训练"数据 (用于同步)
// =================================================================
app.get('/api/pending-data', async (req, res) => {
  try {
    const docs = await db.find({ status: 'pending' }).sort({ createdAt: 1 });
    res.json({ success: true, data: docs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// =================================================================
// 🌟 6. 标记为"已训练"
// =================================================================
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

// =================================================================
// 🌟 7. 接收推理纠错样本
// =================================================================
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

// =================================================================
// 🌟 8. 接收前端发布的模型
// =================================================================
const modelUpload = multer({
  storage: multer.diskStorage({
    destination: MODEL_DIR,
    filename: (req, f, cb) => cb(null, f.originalname)
  })
});
app.post('/api/upload-model', modelUpload.any(), (req, res) => res.json({ success: true }));
app.post('/api/upload-labels', async (req, res) => {
  fs.writeFileSync(path.join(MODEL_DIR, 'labels.json'), JSON.stringify(req.body.labels));
  res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`✅ 数据中心服务已启动: http://localhost:${PORT}`);
});