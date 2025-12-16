const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const database = require('./database'); // 立即导入

const app = express();
app.use('/api', homeworkRoutes); // 使用/api前缀


// 或者对于Render平台，建议使用：
app.set('trust proxy', true); // 最简单有效

// 基础中间件
	app.use(
	  helmet({
		contentSecurityPolicy: {
		  directives: {
			defaultSrc: ["'self'"],
			scriptSrc: ["'self'", "'unsafe-inline'"], // 允许内联脚本
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
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP限制100个请求
  message: { 
    success: false, 
    error: '请求过于频繁，请稍后再试' 
  },
  standardHeaders: true, // 返回标准的 `RateLimit-*` 头部信息
  legacyHeaders: false, // 不返回 `X-RateLimit-*` 头部信息
  // 🔐 关键修复：明确信任代理，并配置如何获取真实IP
  trustProxy: 1, // 信任第一层代理（Render平台通常只有一层）
  keyGenerator: (req, res) => {
    // 优先从 `X-Forwarded-For` 头部获取IP，这是代理传递的真实客户端IP
    // 如果头部不存在，则回退到连接远程地址
    const forwardedFor = req.headers['x-forwarded-for'];
    if (forwardedFor) {
      // `X-Forwarded-For` 格式可能是 "client, proxy1, proxy2"，取第一个IP
      return forwardedFor.split(',')[0].trim();
    }
    return req.socket.remoteAddress; // 备用方案
  }
});

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'donation-collection-system',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development'
  });
});

// API根路径
app.get('/api', (req, res) => {
  res.json({
    success: true,
    message: '功课收集系统API',
    version: '1.0.0',
    endpoints: {
      submit: '/api/submit',
      records: '/api/records',
      update: '/api/update',
      delete: '/api/delete',
      stats: '/api/stats',
      export: '/api/export/csv',
      test: '/api/test'
    },
    timestamp: new Date().toISOString(),
    database: 'homework_db'
  });
});

// API测试端点
app.get('/api/test', async (req, res) => {
  try {
    await database.connect();
    const collections = await database.db.listCollections().toArray();
    
    res.json({ 
      success: true, 
      message: '服务器和数据库连接正常',
      database: {
        name: database.db.databaseName,
        collections: collections.map(c => c.name)
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: '数据库连接失败',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 管理页面路由
app.get('/manage', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 立即加载路由，避免延迟
const homeworkRoutes = require('./routes'); // 修改这里，使用更清晰的命名
app.use('/api', homeworkRoutes); // 使用/api前缀
console.log('✅ 路由已加载');

// 404处理
app.use((req, res) => {
  res.status(404).json({ 
    success: false, 
    error: '请求的资源不存在',
    path: req.path
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
