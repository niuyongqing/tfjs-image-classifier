const tf = require('@tensorflow/tfjs-node');
const mobilenet = require('@tensorflow-models/mobilenet');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const MODEL_SAVE_DIR = path.join(__dirname, '../../public/current-model');
const BASE_MODEL_PATH = path.join(__dirname, '../../public/mobilenet_base/model.json');

const META_PATH = path.join(MODEL_SAVE_DIR, 'meta.json');
const DEFAULT_META = { bestValAcc: 0, bestEpoch: 0, bestLoss: 0, bestAcc: 0 };

class BackendTrainer {
    constructor() {
        this.mobilenetModel = null;
        this.classifierModel = null;
        this.isTraining = false;

        // 1. 初始化空状态
        this.status = {
            phase: 'idle',
            epoch: 0, totalEpochs: 0, loss: 0, acc: 0, val_acc: 0,
            bestValAcc: 0, bestEpoch: 0, bestLoss: 0, bestAcc: 0,
            history: []
        };

        // 2. 启动时加载历史记录
        this.loadHistoryMeta();
    }

    // 加载历史记录
    loadHistoryMeta() {
        try {
            if (fs.existsSync(META_PATH)) {
                const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
                this.status.bestValAcc = meta.bestValAcc || 0;
                this.status.bestEpoch = meta.bestEpoch || 0;
                this.status.bestLoss = meta.bestLoss || 0;
                this.status.bestAcc = meta.bestAcc || 0;
                console.log(`📜 已恢复历史记录: Val=${(this.status.bestValAcc * 100).toFixed(1)}%`);
            }
        } catch (e) {
            console.warn('读取历史记录失败或文件不存在');
        }
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
        const cleanName = filename.replace('/uploads/', '').replace('http://localhost:3000', '');
        const imagePath = path.join(UPLOAD_DIR, path.basename(cleanName));
        try {
            if (!fs.existsSync(imagePath)) return null;
            const imageBuffer = fs.readFileSync(imagePath);
            return tf.node.decodeImage(imageBuffer, 3);
        } catch (e) { return null; }
    }

    /**
     * 🌟 增强版数据增强 (修复版)
     */
    augmentTensor(tensor) {
        return tf.tidy(() => {
            let t = tensor.toFloat();

            // 1. 随机左右翻转 (🚨 修复点: 必须先升维到 4D)
            if (Math.random() > 0.5) {
                const batched = t.expandDims(0); // [H,W,C] -> [1,H,W,C]
                const flipped = tf.image.flipLeftRight(batched);
                t = flipped.squeeze(0);          // [1,H,W,C] -> [H,W,C]
            }

            // 2. 随机亮度
            if (Math.random() > 0.5) {
                const delta = (Math.random() - 0.5) * 50;
                t = t.add(delta);
            }

            // 3. 随机缩放 (模拟变焦)
            if (Math.random() > 0.5) {
                const zoomFactor = 0.7 + Math.random() * 0.3; // 0.7 ~ 1.0
                const margin = (1 - zoomFactor) / 2;
                const boxes = [[margin, margin, 1 - margin, 1 - margin]];
                const boxInd = [0];
                const batched = t.expandDims(0);
                const cropped = tf.image.cropAndResize(batched, boxes, boxInd, [224, 224]);
                t = cropped.squeeze(0);
            }

            // 4. 随机噪点
            if (Math.random() > 0.4) {
                const noise = tf.randomNormal(t.shape, 0, 5);
                t = t.add(noise);
            }

            return t.clipByValue(0, 255);
        });
    }

    async startTraining(userConfig = {}) {
        if (this.isTraining) throw new Error('训练已在进行中');

        const config = {
            epochs: 20, batchSize: 16, validationSplit: 0.2, learningRate: 0.001,
            useIncremental: false, denseUnits: 128, dropoutRate: 0.5, l2Rate: 0.001,
            ...userConfig
        };

        this.isTraining = true;

        // 保留历史最佳数据
        this.status = {
            phase: 'processing', epoch: 0, totalEpochs: config.epochs,
            loss: 0, acc: 0, val_acc: 0,
            bestValAcc: this.status.bestValAcc,
            bestEpoch: this.status.bestEpoch,
            bestLoss: this.status.bestLoss,
            bestAcc: this.status.bestAcc,
            history: []
        };

        try {
            const allDocs = await db.find({});
            if (allDocs.length < 2) throw new Error('样本不足');
            await this.loadBaseModel();

            const inputs = []; const labels = []; const labelSet = new Set();
            console.log(`📦 数据处理中...`);

            for (const doc of allDocs) {
                const rawTensor = await this.imageToTensor(doc.imageUrl);
                if (rawTensor) {
                    // 原图
                    inputs.push(this.mobilenetModel.infer(rawTensor, true));
                    labels.push(doc.label);
                    // 增强图
                    const augTensor = this.augmentTensor(rawTensor);
                    inputs.push(this.mobilenetModel.infer(augTensor, true));
                    labels.push(doc.label);

                    rawTensor.dispose(); augTensor.dispose();
                    labelSet.add(doc.label);
                }
            }

            if (inputs.length === 0) throw new Error('无有效样本');

            const uniqueLabels = Array.from(labelSet).sort();
            const xs = tf.concat(inputs);
            const ys = tf.tidy(() => tf.oneHot(
                tf.tensor1d(labels.map(l => uniqueLabels.indexOf(l)), 'int32'),
                uniqueLabels.length
            ));

            const featureSize = xs.shape[1];
            let model = null;
            const modelJsonPath = path.join(MODEL_SAVE_DIR, 'model.json');
            const labelsPath = path.join(MODEL_SAVE_DIR, 'labels.json');

            let globalBest = { ...DEFAULT_META };
            let isSameTask = false;

            if (fs.existsSync(labelsPath)) {
                try {
                    const oldLabels = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
                    if (JSON.stringify(oldLabels) === JSON.stringify(uniqueLabels)) {
                        isSameTask = true;
                        if (fs.existsSync(META_PATH)) {
                            const metaFromFile = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
                            if (typeof metaFromFile.bestValAcc === 'number') {
                                globalBest = { ...DEFAULT_META, ...metaFromFile };
                            }
                            console.log(`🏆 继承纪录: Val=${(globalBest.bestValAcc * 100).toFixed(1)}%`);
                        }
                    }
                } catch (e) { }
            }

            if (!isSameTask) {
                console.log('✨ 新任务，重置纪录。');
                globalBest = { ...DEFAULT_META };
            }

            if (config.useIncremental && isSameTask && fs.existsSync(modelJsonPath)) {
                try {
                    model = await tf.loadLayersModel(`file://${modelJsonPath}`);
                    console.log('💾 加载旧模型...');
                } catch (e) { }
            }

            if (!model) {
                model = tf.sequential({
                    layers: [
                        tf.layers.dense({
                            inputShape: [featureSize], units: config.denseUnits, activation: 'relu',
                            kernelInitializer: 'varianceScaling',
                            kernelRegularizer: config.l2Rate > 0 ? tf.regularizers.l2({ l2: config.l2Rate }) : undefined
                        }),
                        tf.layers.dropout({ rate: config.dropoutRate }),
                        tf.layers.dense({ units: uniqueLabels.length, activation: 'softmax' })
                    ]
                });
            }

            const optimizer = tf.train.adam(config.learningRate);

            model.compile({
                optimizer: optimizer,
                loss: 'categoricalCrossentropy',
                metrics: ['accuracy']
            });

            this.status.bestValAcc = globalBest.bestValAcc;
            this.status.bestEpoch = globalBest.bestEpoch;
            this.status.bestLoss = globalBest.bestLoss;
            this.status.bestAcc = globalBest.bestAcc;
            this.status.phase = 'training';

            console.log(`🔥 开始训练... (LRate: ${config.learningRate})`);

            let patienceCounter = 0;
            let currentBestInSession = 0;

            await model.fit(xs, ys, {
                epochs: config.epochs,
                batchSize: config.batchSize,
                validationSplit: config.validationSplit,
                shuffle: true,
                callbacks: {
                    onEpochEnd: async (epoch, logs) => {
                        const currentValAcc = logs.val_acc || 0;
                        const currentEpoch = epoch + 1;

                        // 学习率衰减
                        if (currentValAcc > currentBestInSession) {
                            currentBestInSession = currentValAcc;
                            patienceCounter = 0;
                        } else {
                            patienceCounter++;
                            if (patienceCounter >= 3) {
                                const oldLr = optimizer.learningRate;
                                const newLr = oldLr * 0.5;
                                if (newLr > 1e-6) {
                                    optimizer.learningRate = newLr;
                                    console.log(`📉 学习率衰减: ${oldLr.toFixed(5)} -> ${newLr.toFixed(5)}`);
                                    patienceCounter = 0;
                                }
                            }
                        }

                        // 保存最佳
                        if (currentValAcc > globalBest.bestValAcc) {
                            globalBest.bestValAcc = currentValAcc;
                            globalBest.bestEpoch = currentEpoch;
                            globalBest.bestLoss = logs.loss;
                            globalBest.bestAcc = logs.acc;

                            console.log(`🚀 打破历史纪录! Val: ${(currentValAcc * 100).toFixed(1)}%`);

                            if (!fs.existsSync(MODEL_SAVE_DIR)) fs.mkdirSync(MODEL_SAVE_DIR, { recursive: true });
                            await model.save(`file://${MODEL_SAVE_DIR}`);
                            fs.writeFileSync(labelsPath, JSON.stringify(uniqueLabels));
                            fs.writeFileSync(META_PATH, JSON.stringify(globalBest));
                        }

                        // 更新状态
                        this.status.epoch = currentEpoch;
                        this.status.loss = logs.loss;
                        this.status.acc = logs.acc;
                        this.status.val_acc = currentValAcc;

                        this.status.bestValAcc = globalBest.bestValAcc;
                        this.status.bestEpoch = globalBest.bestEpoch;
                        this.status.bestLoss = globalBest.bestLoss;
                        this.status.bestAcc = globalBest.bestAcc;

                        this.status.history.push({ epoch: currentEpoch, loss: logs.loss, acc: logs.acc, val_acc: currentValAcc });

                        console.log(`Epoch ${currentEpoch}: val=${currentValAcc.toFixed(4)}`);
                    }
                }
            });

            console.log(`🏆 训练结束。保留最佳: Val=${(globalBest.bestValAcc * 100).toFixed(1)}%`);

            await db.update({ status: 'pending' }, { $set: { status: 'trained' } }, { multi: true });
            this.status.phase = 'complete';
            this.isTraining = false;

            inputs.forEach(t => t.dispose());
            xs.dispose(); ys.dispose(); model.dispose();
            return { success: true };

        } catch (error) {
            console.error(error);
            this.status.phase = 'error';
            this.status.error = error.message;
            this.isTraining = false;
            throw error;
        }
    }

    getStatus() { return { isTraining: this.isTraining, ...this.status }; }
}

module.exports = new BackendTrainer();