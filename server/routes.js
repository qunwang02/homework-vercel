const express = require('express');
const router = express.Router();
const database = require('./database');
const { ObjectId } = require('mongodb');

// ================== 基础健康检查路由 ==================

// 健康检查端点
router.get('/health', async (req, res) => {
  try {
    // 尝试连接数据库
    await database.connect();
    const db = database.db;
    
    // 检查数据库连接
    const pingResult = await db.command({ ping: 1 });
    
    res.json({
      success: true,
      message: '服务器和数据库运行正常',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: {
        connected: true,
        ping: pingResult.ok === 1 ? '正常' : '异常',
        dbName: db.databaseName
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      message: '服务器运行正常，但数据库连接异常',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// 测试端点
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'API测试成功',
    timestamp: new Date().toISOString(),
    data: {
      status: 'active',
      version: '1.0.0',
      endpoints: [
        '/api/health',
        '/api/test',
        '/api/submit',
        '/api/records',
        '/api/update',
        '/api/delete',
        '/api/stats',
        '/api/export/csv'
      ]
    }
  });
});

// 确保数据库连接的中间件
async function ensureDatabase(req, res, next) {
  try {
    await database.connect();
    next();
  } catch (error) {
    console.error('功课数据库连接错误:', error);
    res.status(503).json({ 
      success: false, 
      error: '功课数据库暂时不可用，请稍后重试',
      timestamp: new Date().toISOString()
    });
  }
}

// ================== 功课相关路由 ==================

// 提交功课记录
router.post('/submit', ensureDatabase, async (req, res) => {
  console.log('📥 [提交] 收到提交请求');
  console.log('📥 [提交] 请求体:', JSON.stringify(req.body, null, 2));
  
  try {
    const db = database.db;
    
    if (!db) {
      throw new Error('数据库实例不存在');
    }
    
    const homeworkCollection = db.collection('homework_records');
    const record = req.body;
    
    // 验证必要字段
    if (!record.date || !record.name) {
      console.log('❌ [提交] 缺少必要字段:', { date: record.date, name: record.name });
      return res.status(400).json({
        success: false,
        error: '日期和姓名是必填项',
        timestamp: new Date().toISOString()
      });
    }
    
    const now = new Date();
    console.log('📝 [提交] 正在准备数据...');
    
    // 准备数据 - 添加药师经字段
    const homeworkRecord = {
      date: record.date,
      name: record.name,
      nineWord: parseInt(record.nineWord) || 0,
      buddhaWorship: parseInt(record.buddhaWorship) || 0,
      quietZen: parseInt(record.quietZen) || 0,
      activeZen: parseInt(record.activeZen) || 0,
      diamond: parseInt(record.diamond) || 0,
      amitabha: parseInt(record.amitabha) || 0,
      guanyin: parseInt(record.guanyin) || 0,
      puxian: parseInt(record.puxian) || 0,
      dizang: parseInt(record.dizang) || 0,
      yaoshi: parseInt(record.yaoshi) || 0, // 添加药师经字段
      remark: record.remark || '',
      deviceId: record.deviceId || 'web',
      submitTime: now,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
      syncStatus: 'synced'
    };
    
    console.log('📝 [提交] 准备插入的数据:', JSON.stringify(homeworkRecord, null, 2));
    
    // 尝试插入
    console.log('💾 [提交] 正在插入数据...');
    const result = await homeworkCollection.insertOne(homeworkRecord);
    
    console.log('✅ [提交] 插入成功:', {
      insertedId: result.insertedId,
      acknowledged: result.acknowledged,
      insertedCount: result.insertedCount
    });
    
    // 立即验证 - 方法1：直接查询
    console.log('🔍 [提交] 立即验证数据...');
    const insertedDoc = await homeworkCollection.findOne({ _id: result.insertedId });
    
    if (insertedDoc) {
      console.log('✅ [提交] 数据验证成功，已插入数据库');
      console.log('📋 [提交] 插入的数据:', {
        _id: insertedDoc._id.toString(),
        date: insertedDoc.date,
        name: insertedDoc.name,
        submitTime: insertedDoc.submitTime
      });
    } else {
      console.log('❌ [提交] 数据验证失败，未找到插入的数据');
    }
    
    // 方法2：统计总数
    const totalCount = await homeworkCollection.countDocuments({});
    console.log(`📊 [提交] 当前总记录数: ${totalCount}`);
    
    // 方法3：查找最近5条记录
    const recentRecords = await homeworkCollection
      .find({})
      .sort({ submittedAt: -1 })
      .limit(5)
      .toArray();
    
    console.log('📋 [提交] 最近5条记录ID:', recentRecords.map(r => r._id.toString()));
    
    // 记录日志
    try {
      await db.collection('homework_logs').insertOne({
        type: 'homework_submit',
        recordId: result.insertedId,
        name: record.name,
        date: record.date,
        timestamp: now,
        ip: req.ip,
        clientInfo: req.headers['user-agent']
      });
      console.log('📊 [提交] 日志记录成功');
    } catch (logError) {
      console.warn('⚠️ [提交] 日志记录失败（不影响主流程）:', logError.message);
    }
    
    res.json({
      success: true,
      message: '功课记录提交成功',
      recordId: result.insertedId,
      timestamp: now.toISOString(),
      verification: {
        found: !!insertedDoc,
        totalCount: totalCount,
        recentRecordIds: recentRecords.map(r => r._id.toString())
      }
    });
    
  } catch (error) {
    console.error('❌ [提交] 提交失败:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
});

// 获取功课记录
router.get('/records', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    
    const limit = parseInt(req.query.limit) || 100;
    const page = parseInt(req.query.page) || 1;
    const skip = (page - 1) * limit;
    
    // 获取数据和总数
    const [records, totalCount] = await Promise.all([
      homeworkCollection
        .find({})
        .sort({ submittedAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      homeworkCollection.countDocuments({})
    ]);
    
    // 格式化数据 - 添加药师经字段
    const formattedData = records.map(item => ({
      _id: item._id.toString(),
      date: item.date || new Date(item.submittedAt).toISOString().split('T')[0],
      name: item.name || '',
      nineWord: item.nineWord || 0,
      buddhaWorship: item.buddhaWorship || 0,
      quietZen: item.quietZen || 0,
      activeZen: item.activeZen || 0,
      diamond: item.diamond || 0,
      amitabha: item.amitabha || 0,
      guanyin: item.guanyin || 0,
      puxian: item.puxian || 0,
      dizang: item.dizang || 0,
      yaoshi: item.yaoshi || 0, // 添加药师经字段
      remark: item.remark || '',
      submitTime: item.submittedAt || item.createdAt || new Date(),
      createdAt: item.createdAt || new Date(),
      deviceId: item.deviceId || 'web'
    }));
    
    res.json({
      success: true,
      data: formattedData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取功课记录错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 更新功课记录
router.put('/update', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    const { id, ...updateData } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: '记录ID是必需的',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await homeworkCollection.updateOne(
      { _id: new ObjectId(id) },
      { 
        $set: {
          ...updateData,
          updatedAt: new Date()
        }
      }
    );
    
    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        error: '找不到指定的功课记录',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: '功课记录更新成功',
      modifiedCount: result.modifiedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('更新功课记录错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 删除功课记录（注意：原始代码中有重复定义，这里使用ensureDatabase版本）
router.delete('/delete', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    const { id } = req.body;
    
    if (!id) {
      return res.status(400).json({
        success: false,
        error: '记录ID是必需的',
        timestamp: new Date().toISOString()
      });
    }
    
    const result = await homeworkCollection.deleteOne({ 
      _id: new ObjectId(id) 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: '找不到指定的功课记录',
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: '功课记录删除成功',
      deletedCount: result.deletedCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('删除功课记录错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 功课统计
router.get('/stats', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    
    // 获取基本统计
    const [totalCount, nameStats, classicsStats] = await Promise.all([
      homeworkCollection.countDocuments({}),
      
      // 按姓名统计
      homeworkCollection.aggregate([
        { $group: {
          _id: '$name',
          count: { $sum: 1 },
          lastSubmit: { $max: '$submittedAt' }
        }},
        { $sort: { count: -1 } }
      ]).toArray(),
      
      // 经典统计 - 添加药师经统计
      homeworkCollection.aggregate([
        { $group: {
          _id: null,
          totalNineWord: { $sum: '$nineWord' },
          totalBuddhaWorship: { $sum: '$buddhaWorship' },
          totalQuietZen: { $sum: '$quietZen' },
          totalActiveZen: { $sum: '$activeZen' },
          totalDiamond: { $sum: '$diamond' },
          totalAmitabha: { $sum: '$amitabha' },
          totalGuanyin: { $sum: '$guanyin' },
          totalPuxian: { $sum: '$puxian' },
          totalDizang: { $sum: '$dizang' },
          totalYaoshi: { $sum: '$yaoshi' } // 添加药师经统计
        }}
      ]).toArray()
    ]);
    
    // 今日记录
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await homeworkCollection.countDocuments({
      date: today
    });
    
    // 经典总数
    const classicsTotal = classicsStats[0] || {
      totalDiamond: 0,
      totalAmitabha: 0,
      totalGuanyin: 0,
      totalPuxian: 0,
      totalDizang: 0,
      totalYaoshi: 0 // 添加药师经
    };
    
    const totalClassics = classicsTotal.totalDiamond + 
                         classicsTotal.totalAmitabha + 
                         classicsTotal.totalGuanyin + 
                         classicsTotal.totalPuxian + 
                         classicsTotal.totalDizang +
                         classicsTotal.totalYaoshi; // 添加药师经
    
    const stats = {
      totalRecords: totalCount,
      todayRecords: todayCount,
      nameStats: nameStats,
      classicsStats: classicsTotal,
      totalClassics: totalClassics,
      // 禅修统计
      meditationStats: {
        totalNineWord: classicsTotal.totalNineWord || 0,
        totalBuddhaWorship: classicsTotal.totalBuddhaWorship || 0,
        totalQuietZen: classicsTotal.totalQuietZen || 0,
        totalActiveZen: classicsTotal.totalActiveZen || 0
      }
    };
    
    res.json({
      success: true,
      stats: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取功课统计错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 导出功课数据
router.get('/export/csv', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    
    // 获取所有数据
    const records = await homeworkCollection
      .find({})
      .sort({ submittedAt: -1 })
      .toArray();
    
    // 构建CSV内容 - 添加药师经列
    const headers = [
      '日期',
      '姓名',
      '九字禅(声)',
      '礼佛拜忏文(遍)',
      '静禅(分钟)',
      '动禅(分钟)',
      '金刚经(遍)',
      '阿弥陀经(遍)',
      '普门品(遍)',
      '普贤品(遍)',
      '地藏经(遍)',
      '药师经(遍)', // 添加药师经
      '经典总数',
      '备注',
      '提交时间',
      '设备ID'
    ];
    
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += headers.join(',') + '\n';
    
    records.forEach((item) => {
      // 计算经典总数 - 包含药师经
      const totalClassics = (item.diamond || 0) + 
                           (item.amitabha || 0) + 
                           (item.guanyin || 0) + 
                           (item.puxian || 0) + 
                           (item.dizang || 0) +
                           (item.yaoshi || 0); // 添加药师经
      
      const row = [
        `"${item.date || ''}"`,
        `"${item.name || ''}"`,
        item.nineWord || 0,
        item.buddhaWorship || 0,
        item.quietZen || 0,
        item.activeZen || 0,
        item.diamond || 0,
        item.amitabha || 0,
        item.guanyin || 0,
        item.puxian || 0,
        item.dizang || 0,
        item.yaoshi || 0, // 添加药师经
        totalClassics,
        `"${item.remark || ''}"`,
        item.submittedAt ? new Date(item.submittedAt).toISOString() : '',
        `"${item.deviceId || ''}"`
      ];
      csvContent += row.join(',') + '\n';
    });
    
    // 设置响应头
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const fileName = `功课记录_${timestamp}_${records.length}条.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    res.send(csvContent);
    
  } catch (error) {
    console.error('导出CSV错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 直接查询数据库状态
router.get('/debug/db-status', ensureDatabase, async (req, res) => {
  try {
    const db = database.db;
    
    // 获取数据库信息
    const dbStats = await db.command({ dbStats: 1 });
    
    // 获取集合信息
    const collections = await db.listCollections().toArray();
    
    // 获取每个集合的文档数量
    const collectionStats = [];
    for (const collInfo of collections) {
      const collection = db.collection(collInfo.name);
      const count = await collection.countDocuments({});
      const sample = await collection.find({}).limit(1).toArray();
      
      collectionStats.push({
        name: collInfo.name,
        count: count,
        sample: sample.length > 0 ? sample[0] : null
      });
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      database: {
        name: db.databaseName,
        stats: {
          collections: dbStats.collections,
          objects: dbStats.objects,
          dataSize: dbStats.dataSize,
          storageSize: dbStats.storageSize
        }
      },
      collections: collectionStats
    });
    
  } catch (error) {
    console.error('❌ [调试] 获取数据库状态失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 直接运行 MongoDB 查询
router.get('/debug/query', ensureDatabase, async (req, res) => {
  try {
    const db = database.db;
    const collection = db.collection('homework_records');
    
    // 运行几个不同的查询
    const queries = {
      totalCount: await collection.countDocuments({}),
      todayCount: await collection.countDocuments({ 
        date: new Date().toISOString().split('T')[0] 
      }),
      allRecords: await collection.find({}).sort({ submittedAt: -1 }).limit(10).toArray(),
      rawQuery: await collection.find({}).toArray()
    };
    
    console.log('🔍 [调试] 查询结果:', {
      totalCount: queries.totalCount,
      todayCount: queries.todayCount,
      sampleCount: queries.allRecords.length
    });
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      queries: queries
    });
    
  } catch (error) {
    console.error('❌ [调试] 查询失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
