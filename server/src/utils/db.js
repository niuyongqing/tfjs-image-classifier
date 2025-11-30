// server/src/utils/db.js
const Datastore = require('nedb-promises');
const path = require('path');
const fs = require('fs');

// 1. 定义数据库路径 (相对于当前文件的位置)
// 当前在 src/utils/，往上两级回到 server/，再进 db/
const DB_PATH = path.join(__dirname, '../../db/data.db');

// 2. 确保目录存在 (双重保险)
const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// 3. 创建并导出唯一的数据库实例
const db = Datastore.create({
    filename: DB_PATH,
    autoload: true
});

console.log(`💾 数据库实例已加载: ${DB_PATH}`);

module.exports = db;