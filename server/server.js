const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const database = require('./database'); // 立即导入

const app = express();

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

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: '请求过于频繁，请稍后再试'
});
app.use('/api/', limiter);

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
const routes = require('./routes');
app.use('/api', routes); // 注意这里使用/api前缀
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
