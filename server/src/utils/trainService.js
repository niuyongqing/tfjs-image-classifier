// server/src/utils/trainService.js
const tf = require('@tensorflow/tfjs-node');
const mobilenet = require('@tensorflow-models/mobilenet');
const path = require('path');
const fs = require('fs');


// 配置路径 (根据你的 server.js 相对位置调整)
const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const MODEL_SAVE_DIR = path.join(__dirname, '../../public/current-model');
const BASE_MODEL_PATH = path.join(__dirname, '../../public/mobilenet_base/model.json');

const db = require('./db');

class BackendTrainer {
    constructor() {
        this.mobilenetModel = null;
        this.classifierModel = null;
        this.isTraining = false;
        // 🌟 新增：用来存储训练状态，供前端查询
        this.status = {
            phase: 'idle', // idle, processing, training, complete, error
            epoch: 0,
            totalEpochs: 0,
            loss: 0,
            acc: 0,
            logs: []
        };
    }

    async loadBaseModel() {
        if (this.mobilenetModel) return;
        console.log('⏳ 正在加载 MobileNet...');
        this.mobilenetModel = await mobilenet.load({
            version: 2, alpha: 1.0,
            modelUrl: `file://${BASE_MODEL_PATH}`
        });
    }

    async imageToTensor(filename) {
        // 处理 URL 路径转本地文件路径
        const cleanName = filename.replace('/uploads/', '').replace('http://localhost:3000', '');
        const imagePath = path.join(UPLOAD_DIR, path.basename(cleanName));
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            return tf.node.decodeImage(imageBuffer, 3);
        } catch (e) {
            return null;
        }
    }

    // 🌟 修改：增加 epochs 参数
    async startTraining(config = { epochs: 20 }) {
        if (this.isTraining) throw new Error('训练已在进行中');

        this.isTraining = true;
        this.status = { phase: 'processing', epoch: 0, totalEpochs: config.epochs, loss: 0, acc: 0 };

        try {
            // 1. 准备数据
            const allDocs = await db.find({});
            if (allDocs.length < 2) throw new Error('样本不足');

            await this.loadBaseModel();

            const inputs = [];
            const labels = [];
            const labelSet = new Set();

            console.log('📦 开始提取特征...');
            let processed = 0;

            for (const doc of allDocs) {
                if (!doc.imageUrl || !doc.label) continue;
                const tensor = await this.imageToTensor(doc.imageUrl);
                if (tensor) {
                    const activation = this.mobilenetModel.infer(tensor, true);
                    inputs.push(activation);
                    labels.push(doc.label);
                    labelSet.add(doc.label);
                    tensor.dispose();
                }
                processed++;
                // 简单更新一下状态，避免前端以为死机
                if (processed % 10 === 0) console.log(`已处理 ${processed} 张图片`);
            }

            if (inputs.length === 0) throw new Error('无有效样本');

            // 2. 准备 Tensor
            const uniqueLabels = Array.from(labelSet).sort();
            const xs = tf.concat(inputs);
            const ys = tf.tidy(() => tf.oneHot(
                tf.tensor1d(labels.map(l => uniqueLabels.indexOf(l)), 'int32'),
                uniqueLabels.length
            ));

            // 3. 构建模型
            const model = tf.sequential({
                layers: [
                    tf.layers.dense({ inputShape: [1024], units: 128, activation: 'relu' }),
                    tf.layers.dropout({ rate: 0.5 }), // 提高 Dropout 防止过拟合
                    tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' })
                ]
            });

            model.compile({
                optimizer: tf.train.adam(0.001),
                loss: 'categoricalCrossentropy',
                metrics: ['accuracy']
            });

            // 4. 训练 (带回调更新状态)
            this.status.phase = 'training';
            console.log('🔥 开始训练 Loop...');

            await model.fit(xs, ys, {
                epochs: config.epochs,
                batchSize: 16,
                shuffle: true,
                validationSplit: 0.2, // 增加验证集
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        // 🌟 实时更新状态
                        this.status.epoch = epoch + 1;
                        this.status.loss = logs.loss;
                        this.status.acc = logs.acc;
                        this.status.val_acc = logs.val_acc;
                        console.log(`Epoch ${epoch + 1}: loss=${logs.loss.toFixed(4)}, acc=${logs.acc.toFixed(4)}`);
                    }
                }
            });

            // 5. 保存
            if (!fs.existsSync(MODEL_SAVE_DIR)) fs.mkdirSync(MODEL_SAVE_DIR, { recursive: true });
            await model.save(`file://${MODEL_SAVE_DIR}`);
            fs.writeFileSync(path.join(MODEL_SAVE_DIR, 'labels.json'), JSON.stringify(uniqueLabels));

            // 更新数据库状态
            await db.update({ status: 'pending' }, { $set: { status: 'trained' } }, { multi: true });

            this.status.phase = 'complete';
            this.isTraining = false;

            // 清理
            xs.dispose();
            ys.dispose();
            model.dispose();

            return { success: true };

        } catch (error) {
            console.error(error);
            this.status.phase = 'error';
            this.status.error = error.message;
            this.isTraining = false;
            throw error;
        }
    }

    // 获取当前状态
    getStatus() {
        return { isTraining: this.isTraining, ...this.status };
    }
}

module.exports = new BackendTrainer();