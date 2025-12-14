const express = require('express');
const app = express();

// 根路径返回简单消息
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>测试页面</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .success { color: green; }
            .error { color: red; }
        </style>
    </head>
    <body>
        <h1>🚀 服务器已启动！</h1>
        <p>如果看到此页面，说明Express服务器已成功部署到Render</p>
        <p>当前时间：${new Date().toLocaleString()}</p>
        <p>Node.js版本：${process.version}</p>
        <p>环境：${process.env.NODE_ENV || 'development'}</p>
    </body>
    </html>
  `);
});

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// 测试数据库连接端点
app.get('/test-db', (req, res) => {
  const mongodb = require('mongodb');
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
  
  mongodb.MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(client => {
      res.json({ 
        success: true, 
        message: 'MongoDB连接成功',
        databases: client.db().admin().listDatabases()
      });
      client.close();
    })
    .catch(err => {
      res.json({ 
        success: false, 
        message: 'MongoDB连接失败',
        error: err.message 
      });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ 服务器正在端口 ${PORT} 上运行`);
  console.log(`📡 访问地址: http://localhost:${PORT}`);
  console.log(`🔧 环境: ${process.env.NODE_ENV || 'development'}`);
});