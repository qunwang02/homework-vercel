const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const database = require('./database');

const app = express();

// 基础中间件
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求日志
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  keyGenerator: (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = forwarded ? forwarded.split(',')[0].trim() : req.ip;
    return clientIp;
  }
});

// 调试：记录所有请求路径
app.use((req, res, next) => {
  console.log(`📥 请求: ${req.method} ${req.originalUrl}`);
  next();
});

// 加载API路由
try {
  const routes = require('./routes');
  app.use('/api', routes);
  console.log('✅ API路由已加载');
} catch (error) {
  console.error('❌ 加载API路由失败:', error);
}

// 测试数据查询路由
app.get('/api/check-data', async (req, res) => {
  try {
    console.log('🔍 检查数据请求收到');
    
    const db = await database.connect();
    
    if (!db) {
      return res.json({
        success: false,
        error: '数据库未连接'
      });
    }
    
    const collection = db.collection('homework_records');
    const totalCount = await collection.countDocuments({});
    console.log(`📊 总记录数: ${totalCount}`);
    
    const recentRecords = await collection
      .find({})
      .sort({ submittedAt: -1 })
      .limit(5)
      .toArray();
    
    console.log(`📋 最近记录数: ${recentRecords.length}`);
    
    res.json({
      success: true,
      totalCount: totalCount,
      recentRecords: recentRecords.map(record => ({
        _id: record._id.toString(),
        date: record.date,
        name: record.name,
        submitTime: record.submittedAt,
        nineWord: record.nineWord,
        diamond: record.diamond
      })),
      message: `数据库中有 ${totalCount} 条记录`
    });
    
  } catch (error) {
    console.error('❌ 检查数据时出错:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 统计信息 - 支持日期范围
app.get('/api/stats', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const client = await connectToMongoDB();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // 构建查询条件
    const query = {};
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.date = { $gte: startDate };
    } else if (endDate) {
      query.date = { $lte: endDate };
    }
    
    const total = await collection.countDocuments(query);
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await collection.countDocuments({ date: today });
    
    // 按姓名统计
    const nameStats = await collection.aggregate([
      { $match: query },
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
      { $match: query },
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

// 测试插入路由
app.post('/api/test-insert', async (req, res) => {
  try {
    console.log('📥 测试插入请求收到:', req.body);
    
    const db = await database.connect();
    const collection = db.collection('homework_records');
    
    const testData = {
      date: new Date().toISOString().split('T')[0],
      name: '测试用户' + Date.now(),
      nineWord: Math.floor(Math.random() * 100),
      diamond: Math.floor(Math.random() * 3) + 1,
      submitTime: new Date(),
      submittedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      deviceId: 'test-insert',
      remark: '测试插入的数据'
    };
    
    console.log('📝 准备插入测试数据:', testData);
    
    const result = await collection.insertOne(testData);
    console.log('✅ 测试插入成功:', result.insertedId);
    
    const inserted = await collection.findOne({ _id: result.insertedId });
    
    res.json({
      success: true,
      insertedId: result.insertedId.toString(),
      data: inserted,
      message: '测试插入成功'
    });
    
  } catch (error) {
    console.error('❌ 测试插入失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 主页和管理页面路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 测试页面
app.get('/test-page', (req, res) => {
  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>数据验证测试</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; }
      .container { max-width: 800px; margin: 0 auto; }
      .btn { 
        padding: 10px 20px; 
        margin: 5px; 
        background: #007bff; 
        color: white; 
        border: none; 
        border-radius: 4px;
        cursor: pointer;
      }
      .btn:hover { background: #0056b3; }
      .result { 
        margin-top: 20px; 
        padding: 15px; 
        background: #f5f5f5; 
        border-radius: 4px;
        white-space: pre-wrap;
        font-family: monospace;
      }
      .success { border-left: 5px solid green; }
      .error { border-left: 5px solid red; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>数据验证测试页面</h1>
      
      <div>
        <button class="btn" onclick="checkData()">1. 检查数据</button>
        <button class="btn" onclick="insertTest()">2. 测试插入</button>
        <button class="btn" onclick="healthCheck()">3. 健康检查</button>
        <button class="btn" onclick="queryRecords()">4. 查询记录</button>
      </div>
      
      <div id="result" class="result"></div>
      
      <script>
        function displayResult(data, isSuccess = true) {
          const resultDiv = document.getElementById('result');
          resultDiv.textContent = JSON.stringify(data, null, 2);
          resultDiv.className = 'result ' + (isSuccess ? 'success' : 'error');
        }
        
        async function checkData() {
          try {
            const response = await fetch('/api/check-data');
            const data = await response.json();
            displayResult(data, data.success);
          } catch (error) {
            displayResult({ error: error.message }, false);
          }
        }
        
        async function insertTest() {
          try {
            const response = await fetch('/api/test-insert', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ test: true })
            });
            const data = await response.json();
            displayResult(data, data.success);
          } catch (error) {
            displayResult({ error: error.message }, false);
          }
        }
        
        async function healthCheck() {
          try {
            const response = await fetch('/api/health');
            const data = await response.json();
            displayResult(data, data.success);
          } catch (error) {
            displayResult({ error: error.message }, false);
          }
        }
        
        async function queryRecords() {
          try {
            const response = await fetch('/api/records?limit=10');
            const data = await response.json();
            displayResult(data, data.success);
          } catch (error) {
            displayResult({ error: error.message }, false);
          }
        }
      </script>
    </div>
  </body>
  </html>
  `;
  
  res.send(html);
});

// 404处理
app.use((req, res) => {
  console.log(`❌ 404: 路径 ${req.path} 不存在`);
  res.status(404).json({ 
    success: false, 
    error: '请求的资源不存在',
    path: req.path,
    method: req.method
  });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  res.status(500).json({ 
    success: false, 
    error: process.env.NODE_ENV === 'development' ? err.message : '服务器内部错误'
  });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 服务器正在端口 ${PORT} 上运行`);
  console.log(`📡 访问地址: http://localhost:${PORT}`);
  console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 管理页面: http://localhost:${PORT}/manage`);
  console.log(`🧪 测试页面: http://localhost:${PORT}/test-page`);
  
  // 延迟连接数据库
  setTimeout(async () => {
    try {
      await database.connect();
      console.log('✅ 数据库连接成功');
    } catch (error) {
      console.error('⚠️ 数据库连接失败，但服务器继续运行:', error.message);
    }
  }, 3000);
});
