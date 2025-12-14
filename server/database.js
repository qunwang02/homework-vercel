const { MongoClient, ServerApiVersion } = require('mongodb');

class Database {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async connect() {
    try {
      if (this.isConnected) {
        console.log('✅ 已连接到数据库');
        return this.db;
      }
      
      // 从环境变量获取连接字符串，或使用默认值
      const uri = process.env.MONGODB_URI || 'mongodb+srv://nanmo009:Wwx731217@cluster-fosheng.r3b5crc.mongodb.net/?appName=cluster-fosheng';
      const dbName = process.env.DATABASE_NAME || 'donation_system';
      
      console.log(`🔗 正在连接到MongoDB: ${dbName}`);
      
      // 创建MongoDB客户端
      this.client = new MongoClient(uri, {
        serverApi: {
          version: ServerApiVersion.v1,
          strict: true,
          deprecationErrors: true,
        },
        connectTimeoutMS: 10000,
        socketTimeoutMS: 45000,
      });
      
      // 连接数据库
      await this.client.connect();
      
      this.db = this.client.db(dbName);
      this.isConnected = true;
      
      // 测试连接
      await this.db.command({ ping: 1 });
      
      console.log('✅ MongoDB连接成功');
      console.log(`📁 数据库: ${dbName}`);
      
      return this.db;
    } catch (error) {
      console.error('❌ MongoDB连接失败:', error.message);
      
      // 重试逻辑
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`🔄 重试连接 (${this.retryCount}/${this.maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.connect();
      }
      
      throw error;
    }
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.close();
        this.isConnected = false;
        console.log('✅ MongoDB连接已关闭');
      }
    } catch (error) {
      console.error('❌ 关闭MongoDB连接失败:', error.message);
    }
  }

  getCollection(name) {
    if (!this.db) {
      throw new Error('数据库未连接，请先调用connect()方法');
    }
    return this.db.collection(name);
  }

  donations() {
    return this.getCollection('donations');
  }
}

// 创建单例实例
const database = new Database();

// 自动重连机制
setInterval(async () => {
  if (!database.isConnected) {
    try {
      console.log('🔄 尝试自动重新连接数据库...');
      await database.connect();
    } catch (error) {
      console.log('自动重连失败，稍后重试...');
    }
  }
}, 30000); // 每30秒检查一次

module.exports = database;