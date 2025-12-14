require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB 配置
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://nanmo009@gmail:wwx731217@homework-records.7aknbpv.mongodb.net/?appName=homework-records';
const DB_NAME = 'homework_db';
const COLLECTION_NAME = 'homework_records';

let dbClient = null;

// 连接 MongoDB
async function connectToMongoDB() {
  if (dbClient && dbClient.topology && dbClient.topology.isConnected()) {
    return dbClient;
  }
  
  try {
    dbClient = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    
    await dbClient.connect();
    console.log('MongoDB 连接成功');
    return dbClient;
  } catch (error) {
    console.error('MongoDB 连接失败:', error);
    throw error;
  }
}

// 健康检查
app.get('/api/health', async (req, res) => {
  try {
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    
    res.json({
      success: true,
      message: '系统运行正常',
      timestamp: new Date().toISOString(),
      mongodb: 'connected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '系统异常',
      error: error.message
    });
  }
});

// 提交功课
app.post('/api/submit', async (req, res) => {
  try {
    const data = req.body;
    
    // 验证必填字段
    if (!data.date || !data.name) {
      return res.status(400).json({
        success: false,
        error: '日期和姓名为必填项'
      });
    }
    
    // 添加时间戳
    const record = {
      ...data,
      submitTime: new Date().toISOString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    // 保存到MongoDB
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const result = await collection.insertOne(record);
    
    res.json({
      success: true,
      message: '记录保存成功',
      id: result.insertedId,
      record: record
    });
  } catch (error) {
    console.error('提交失败:', error);
    res.status(500).json({
      success: false,
      error: '服务器内部错误',
      details: error.message
    });
  }
});

// 获取所有记录
app.get('/api/records', async (req, res) => {
  try {
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const records = await collection
      .find({})
      .sort({ createdAt: -1 })
      .limit(1000)
      .toArray();
    
    res.json({
      success: true,
      data: records,
      count: records.length
    });
  } catch (error) {
    console.error('获取记录失败:', error);
    res.status(500).json({
      success: false,
      error: '获取记录失败',
      details: error.message
    });
  }
});

// 搜索记录
app.get('/api/search', async (req, res) => {
  try {
    const { name, date } = req.query;
    
    const query = {};
    if (name) query.name = new RegExp(name, 'i');
    if (date) query.date = date;
    
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const records = await collection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    
    res.json({
      success: true,
      data: records,
      count: records.length
    });
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({
      success: false,
      error: '搜索失败',
      details: error.message
    });
  }
});

// 删除记录
app.delete('/api/delete', async (req, res) => {
  try {
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: '记录ID不能为空'
      });
    }
    
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    let result;
    if (id === 'all') {
      // 清空所有记录
      result = await collection.deleteMany({});
    } else {
      // 删除单条记录
      result = await collection.deleteOne({ _id: new ObjectId(id) });
    }
    
    res.json({
      success: true,
      message: id === 'all' ? '所有记录已清空' : '记录已删除',
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('删除失败:', error);
    res.status(500).json({
      success: false,
      error: '删除失败',
      details: error.message
    });
  }
});

// 统计信息
app.get('/api/stats', async (req, res) => {
  try {
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const total = await collection.countDocuments();
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await collection.countDocuments({ date: today });
    
    // 按姓名统计
    const nameStats = await collection.aggregate([
      {
        $group: {
          _id: '$name',
          count: { $sum: 1 },
          lastSubmit: { $max: '$submitTime' },
        },
      },
      { $sort: { count: -1 } },
    ]).toArray();
    
    // 经典诵读统计
    const classicsStats = await collection.aggregate([
      {
        $group: {
          _id: null,
          totalDiamond: { $sum: { $toInt: '$diamond' } },
          totalAmitabha: { $sum: { $toInt: '$amitabha' } },
          totalGuanyin: { $sum: { $toInt: '$guanyin' } },
          totalPuxian: { $sum: { $toInt: '$puxian' } },
          totalDizang: { $sum: { $toInt: '$dizang' } },
        },
      },
    ]).toArray();
    
    res.json({
      success: true,
      stats: {
        totalRecords: total,
        todayRecords: todayCount,
        nameStats,
        classicsStats: classicsStats[0] || {},
      },
    });
  } catch (error) {
    console.error('统计失败:', error);
    res.status(500).json({
      success: false,
      error: '统计失败',
      details: error.message
    });
  }
});

// 更新记录
app.put('/api/update', async (req, res) => {
  try {
    const { id, ...updateData } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: '记录ID不能为空'
      });
    }
    
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    updateData.updatedAt = new Date();
    
    const result = await collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    
    res.json({
      success: true,
      message: '记录更新成功',
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('更新失败:', error);
    res.status(500).json({
      success: false,
      error: '更新失败',
      details: error.message
    });
  }
});

// 根路径重定向到首页
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// 管理页面
app.get('/manage', (req, res) => {
  res.sendFile(__dirname + '/public/manage.html');
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`提交页面: http://localhost:${PORT}`);
  console.log(`管理页面: http://localhost:${PORT}/manage`);
});