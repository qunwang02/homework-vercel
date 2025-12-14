const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 先创建应用，不立即连接数据库
const app = express();

// 基础中间件
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 请求日志（开发环境）
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// 速率限制
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 100, // 每个IP限制100个请求
  message: '请求过于频繁，请稍后再试'
});
app.use('/api/', limiter);

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 健康检查端点（不依赖数据库）
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

// 数据库连接测试端点
app.get('/api/test', async (req, res) => {
  try {
    // 动态导入数据库模块
    const database = require('./database');
    await database.connect();
    res.json({ 
      success: true, 
      message: '服务器和数据库连接正常',
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
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// 延迟加载路由，避免启动时数据库连接失败
setTimeout(() => {
  const routes = require('./routes');
  app.use('/', routes);
  console.log('✅ 路由已加载');
}, 1000);

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

// 启动服务器（不立即连接数据库）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 服务器正在端口 ${PORT} 上运行`);
  console.log(`📡 访问地址: http://localhost:${PORT}`);
  console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 管理页面: http://localhost:${PORT}/admin`);
  
  // 延迟连接数据库，避免启动失败
  setTimeout(async () => {
    try {
      const database = require('./database');
      await database.connect();
      console.log('✅ 数据库连接成功');
    } catch (error) {
      console.error('⚠️ 数据库连接失败，但服务器继续运行:', error.message);
    }
  }, 5000);
});