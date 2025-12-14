const express = require('express');
const router = express.Router();
const database = require('./database');
const { ObjectId } = require('mongodb');

// 中间件：检查数据库连接
async function ensureDatabase(req, res, next) {
  try {
    await database.connect();
    next();
  } catch (error) {
    console.error('数据库连接错误:', error);
    res.status(503).json({ 
      success: false, 
      error: '数据库暂时不可用，请稍后重试',
      timestamp: new Date().toISOString()
    });
  }
}

// 中间件：验证管理员权限
function checkAdminAuth(req, res, next) {
  const adminPassword = req.query.adminPassword || req.body.adminPassword;
  const expectedPassword = process.env.ADMIN_PASSWORD || 'admin123';
  
  if (adminPassword === expectedPassword) {
    next();
  } else {
    res.status(401).json({ 
      success: false, 
      error: '未授权的操作，需要管理员密码',
      timestamp: new Date().toISOString()
    });
  }
}

// ==================== 公共API端点 ====================

// 健康检查端点
router.get('/health', async (req, res) => {
  try {
    await database.connect();
    await database.db.command({ ping: 1 });
    
    res.json({
      success: true,
      status: 'healthy',
      service: 'donation-collection-system',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0'
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
      database: 'disconnected'
    });
  }
});

// 服务器信息端点
router.get('/api/info', (req, res) => {
  res.json({
    success: true,
    name: '护持项目收集系统',
    version: '1.0.0',
    description: '用于收集和管理护持项目信息的系统',
    endpoints: {
      health: '/health',
      test: '/api/test',
      submit: '/api/donations',
      getData: '/api/donations',
      stats: '/api/stats',
      export: '/api/export/csv'
    },
    timestamp: new Date().toISOString()
  });
});

// 连接测试端点
router.get('/api/test', async (req, res) => {
  try {
    await database.connect();
    const collections = await database.db.listCollections().toArray();
    
    res.json({
      success: true,
      message: '服务器和数据库连接正常',
      database: {
        name: database.db.databaseName,
        collections: collections.map(c => c.name),
        collectionCount: collections.length
      },
      server: {
        nodeVersion: process.version,
        platform: process.platform,
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('测试连接错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== 数据操作API端点 ====================

// 提交捐赠数据
router.post('/api/donations', ensureDatabase, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    const { data, batchId, deviceId, retryAttempt } = req.body;
    
    // 验证数据格式
    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        error: '无效的数据格式，请提供data数组',
        timestamp: new Date().toISOString()
      });
    }
    
    // 过滤无效数据
    const validData = data.filter(item => {
      return item && item.name && item.project && 
             typeof item.name === 'string' && 
             typeof item.project === 'string';
    });
    
    if (validData.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有有效的捐赠数据可提交',
        timestamp: new Date().toISOString()
      });
    }
    
    // 为每条数据添加元数据
    const donationsWithMetadata = validData.map((item, index) => {
      const now = new Date();
      const localId = item.localId || `local_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`;
      
      return {
        ...item,
        localId,
        batchId: batchId || `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        deviceId: deviceId || 'unknown',
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
        syncStatus: 'synced',
        syncVersion: '1.0',
        amountTWD: parseFloat(item.amountTWD) || 0,
        amountRMB: parseFloat(item.amountRMB) || 0,
        payment: item.payment || '未缴费',
        contact: item.contact || '',
        content: item.content || '',
        method: item.method || '',
        // 生成服务器端唯一ID
        serverId: new ObjectId().toString(),
        // 如果是重试，记录重试次数
        ...(retryAttempt && { retryAttempt })
      };
    });
    
    // 批量插入数据
    const result = await donationsCollection.insertMany(donationsWithMetadata);
    
    // 记录操作日志
    await database.logs().insertOne({
      type: 'donation_submit',
      batchId: batchId || donationsWithMetadata[0].batchId,
      count: result.insertedCount,
      deviceId: deviceId || 'unknown',
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    });
    
    // 构建成功响应
    const response = {
      success: true,
      message: `成功提交 ${result.insertedCount} 条数据`,
      submittedCount: result.insertedCount,
      failedCount: data.length - validData.length,
      batchId: donationsWithMetadata[0].batchId,
      timestamp: new Date().toISOString(),
      data: {
        insertedIds: Object.values(result.insertedIds),
        firstLocalId: donationsWithMetadata[0]?.localId,
        sampleData: donationsWithMetadata.slice(0, 1)
      }
    };
    
    // 如果有无效数据，添加到响应中
    if (data.length > validData.length) {
      response.warning = `有 ${data.length - validData.length} 条数据因格式无效被忽略`;
    }
    
    res.json(response);
    
  } catch (error) {
    console.error('提交数据错误:', error);
    
    // 检查是否是重复键错误
    if (error.code === 11000 || error.code === 11001) {
      return res.status(409).json({
        success: false,
        error: '部分数据已存在（重复的localId）',
        code: 'DUPLICATE_KEY',
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
});

// 获取捐赠数据（支持分页、筛选和排序）
router.get('/api/donations', ensureDatabase, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    
    // 解析查询参数
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const sortBy = req.query.sortBy || 'submittedAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const search = req.query.search || '';
    const project = req.query.project || '';
    const payment = req.query.payment || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const deviceId = req.query.deviceId || '';
    const batchId = req.query.batchId || '';
    
    // 计算跳过的文档数
    const skip = (page - 1) * limit;
    
    // 构建查询条件
    const query = {};
    
    // 文本搜索
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }
    
    // 精确匹配筛选
    if (project) query.project = project;
    if (payment) query.payment = payment;
    if (deviceId) query.deviceId = deviceId;
    if (batchId) query.batchId = batchId;
    
    // 日期范围筛选
    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) {
        query.submittedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        // 设置结束日期为当天的最后一毫秒
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.submittedAt.$lte = endDateTime;
      }
    }
    
    // 执行查询和统计（并行）
    const [donations, totalCount, stats] = await Promise.all([
      // 获取数据
      donationsCollection
        .find(query)
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(limit)
        .toArray(),
      
      // 获取总记录数
      donationsCollection.countDocuments(query),
      
      // 获取统计信息
      donationsCollection.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' },
            count: { $sum: 1 },
            avgAmountTWD: { $avg: '$amountTWD' },
            avgAmountRMB: { $avg: '$amountRMB' },
            // 按项目统计
            byProject: {
              $push: {
                project: '$project',
                amountTWD: '$amountTWD',
                amountRMB: '$amountRMB'
              }
            }
          }
        }
      ]).toArray()
    ]);
    
    // 处理统计结果
    const statsResult = stats[0] || {
      totalAmountTWD: 0,
      totalAmountRMB: 0,
      count: 0,
      avgAmountTWD: 0,
      avgAmountRMB: 0,
      byProject: []
    };
    
    // 计算各项目统计（如果数据量不大）
    let projectStats = {};
    if (statsResult.byProject && statsResult.byProject.length > 0) {
      statsResult.byProject.forEach(item => {
        if (item.project) {
          if (!projectStats[item.project]) {
            projectStats[item.project] = {
              count: 0,
              totalAmountTWD: 0,
              totalAmountRMB: 0
            };
          }
          projectStats[item.project].count++;
          projectStats[item.project].totalAmountTWD += item.amountTWD || 0;
          projectStats[item.project].totalAmountRMB += item.amountRMB || 0;
        }
      });
    }
    
    // 构建响应
    res.json({
      success: true,
      data: donations,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasNextPage: page < Math.ceil(totalCount / limit),
        hasPrevPage: page > 1
      },
      stats: {
        overall: {
          totalRecords: statsResult.count,
          totalAmountTWD: statsResult.totalAmountTWD,
          totalAmountRMB: statsResult.totalAmountRMB,
          avgAmountTWD: statsResult.avgAmountTWD,
          avgAmountRMB: statsResult.avgAmountRMB
        },
        byProject: Object.entries(projectStats).map(([project, stats]) => ({
          project,
          ...stats
        }))
      },
      query: {
        search,
        project,
        payment,
        startDate,
        endDate,
        deviceId,
        batchId
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取数据错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 获取统计数据
router.get('/api/stats', ensureDatabase, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    
    // 获取日期范围（默认最近30天）
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    // 并行执行多个聚合查询
    const [
      overallStats,
      projectStats,
      paymentStats,
      dailyStats,
      deviceStats,
      recentActivity
    ] = await Promise.all([
      // 总体统计
      donationsCollection.aggregate([
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' },
            avgAmountTWD: { $avg: '$amountTWD' },
            avgAmountRMB: { $avg: '$amountRMB' },
            minAmountTWD: { $min: '$amountTWD' },
            maxAmountTWD: { $max: '$amountTWD' }
          }
        }
      ]).toArray(),
      
      // 按项目统计
      donationsCollection.aggregate([
        {
          $group: {
            _id: '$project',
            count: { $sum: 1 },
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' },
            avgAmountTWD: { $avg: '$amountTWD' },
            avgAmountRMB: { $avg: '$amountRMB' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 20 }
      ]).toArray(),
      
      // 按缴费状态统计
      donationsCollection.aggregate([
        {
          $group: {
            _id: '$payment',
            count: { $sum: 1 },
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' }
          }
        },
        { $sort: { count: -1 } }
      ]).toArray(),
      
      // 每日统计（最近30天）
      donationsCollection.aggregate([
        {
          $match: {
            submittedAt: { $gte: thirtyDaysAgo }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' }
            },
            count: { $sum: 1 },
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' }
          }
        },
        { $sort: { _id: 1 } },
        { $limit: 30 }
      ]).toArray(),
      
      // 按设备统计
      donationsCollection.aggregate([
        {
          $group: {
            _id: '$deviceId',
            count: { $sum: 1 },
            totalAmountTWD: { $sum: '$amountTWD' },
            totalAmountRMB: { $sum: '$amountRMB' }
          }
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray(),
      
      // 最近活动（最近10条记录）
      donationsCollection
        .find({})
        .sort({ submittedAt: -1 })
        .limit(10)
        .toArray()
    ]);
    
    // 计算增长率（与昨天相比）
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yesterdayStats = await donationsCollection.aggregate([
      {
        $match: {
          submittedAt: { 
            $gte: yesterday,
            $lt: today
          }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' }
        }
      }
    ]).toArray();
    
    const todayStats = await donationsCollection.aggregate([
      {
        $match: {
          submittedAt: { $gte: today }
        }
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' }
        }
      }
    ]).toArray();
    
    const yesterdayCount = yesterdayStats[0]?.count || 0;
    const todayCount = todayStats[0]?.count || 0;
    const growthRate = yesterdayCount > 0 
      ? ((todayCount - yesterdayCount) / yesterdayCount * 100).toFixed(1)
      : todayCount > 0 ? '100.0' : '0.0';
    
    res.json({
      success: true,
      overall: overallStats[0] || {
        totalRecords: 0,
        totalAmountTWD: 0,
        totalAmountRMB: 0,
        avgAmountTWD: 0,
        avgAmountRMB: 0,
        minAmountTWD: 0,
        maxAmountTWD: 0
      },
      byProject: projectStats,
      byPayment: paymentStats,
      daily: dailyStats,
      byDevice: deviceStats,
      recentActivity: recentActivity.map(item => ({
        id: item._id || item.localId,
        name: item.name,
        project: item.project,
        amountTWD: item.amountTWD,
        submittedAt: item.submittedAt
      })),
      trends: {
        growthRate: `${growthRate}%`,
        yesterdayCount,
        todayCount
      },
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取统计错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== 数据导出API端点 ====================

// 导出为CSV
router.get('/api/export/csv', ensureDatabase, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    
    // 获取查询参数
    const search = req.query.search || '';
    const project = req.query.project || '';
    const payment = req.query.payment || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    
    // 构建查询条件
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (project) query.project = project;
    if (payment) query.payment = payment;
    
    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) {
        query.submittedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.submittedAt.$lte = endDateTime;
      }
    }
    
    // 获取数据
    const donations = await donationsCollection
      .find(query)
      .sort({ submittedAt: -1 })
      .toArray();
    
    // 构建CSV内容
    const headers = [
      '序号',
      '姓名',
      '护持项目',
      '祈福方式',
      '护持金额(新台币)',
      '护持金额(人民币)',
      '祈福内容',
      '是否缴费',
      '联系人',
      '提交时间',
      '创建时间',
      '设备ID',
      '批次ID',
      '本地ID',
      '服务器ID'
    ];
    
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += headers.join(',') + '\n';
    
    donations.forEach((item, index) => {
      const row = [
        index + 1,
        `"${escapeCSV(item.name || '')}"`,
        `"${escapeCSV(item.project || '')}"`,
        `"${escapeCSV((item.method || '').replace(/\n/g, '; '))}"`,
        item.amountTWD || 0,
        item.amountRMB ? item.amountRMB.toFixed(2) : '0.00',
        `"${escapeCSV(item.content || '')}"`,
        `"${escapeCSV(item.payment || '')}"`,
        `"${escapeCSV(item.contact || '')}"`,
        item.submittedAt ? new Date(item.submittedAt).toISOString() : '',
        item.createdAt ? new Date(item.createdAt).toISOString() : '',
        `"${escapeCSV(item.deviceId || '')}"`,
        `"${escapeCSV(item.batchId || '')}"`,
        `"${escapeCSV(item.localId || '')}"`,
        `"${escapeCSV(item._id ? item._id.toString() : '')}"`
      ];
      csvContent += row.join(',') + '\n';
    });
    
    // 设置响应头
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const fileName = `护持数据_${timestamp}_${donations.length}条.csv`;
    
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // 记录导出日志
    await database.logs().insertOne({
      type: 'export_csv',
      count: donations.length,
      filters: { search, project, payment, startDate, endDate },
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
    
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

// 导出为JSON
router.get('/api/export/json', ensureDatabase, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    
    // 获取查询参数
    const search = req.query.search || '';
    const project = req.query.project || '';
    const payment = req.query.payment || '';
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    
    // 构建查询条件
    const query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { content: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (project) query.project = project;
    if (payment) query.payment = payment;
    
    if (startDate || endDate) {
      query.submittedAt = {};
      if (startDate) {
        query.submittedAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        query.submittedAt.$lte = endDateTime;
      }
    }
    
    // 获取数据
    const donations = await donationsCollection
      .find(query)
      .sort({ submittedAt: -1 })
      .toArray();
    
    // 构建响应
    const exportData = {
      success: true,
      metadata: {
        exportTime: new Date().toISOString(),
        recordCount: donations.length,
        filters: {
          search,
          project,
          payment,
          startDate,
          endDate
        }
      },
      data: donations
    };
    
    // 设置响应头
    const timestamp = new Date().toISOString().slice(0,10).replace(/-/g, '');
    const fileName = `护持数据_${timestamp}_${donations.length}条.json`;
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    // 记录导出日志
    await database.logs().insertOne({
      type: 'export_json',
      count: donations.length,
      filters: { search, project, payment, startDate, endDate },
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress
    });
    
    res.send(JSON.stringify(exportData, null, 2));
    
  } catch (error) {
    console.error('导出JSON错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== 管理操作API端点（需要管理员权限） ====================

// 删除单条数据
router.delete('/api/donations/:id', ensureDatabase, checkAdminAuth, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    const { id } = req.params;
    
    let result;
    let deletedItem = null;
    
    // 尝试通过ObjectId查找
    try {
      if (ObjectId.isValid(id)) {
        deletedItem = await donationsCollection.findOne({ _id: new ObjectId(id) });
        result = await donationsCollection.deleteOne({ _id: new ObjectId(id) });
      }
    } catch (e) {
      // 如果不是有效的ObjectId，尝试其他字段
    }
    
    // 如果没有通过_id找到，尝试通过localId或serverId查找
    if (!result || result.deletedCount === 0) {
      deletedItem = await donationsCollection.findOne({
        $or: [
          { localId: id },
          { serverId: id }
        ]
      });
      
      if (deletedItem) {
        result = await donationsCollection.deleteOne({
          $or: [
            { localId: id },
            { serverId: id }
          ]
        });
      }
    }
    
    if (!result || result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: '找不到指定的记录',
        id,
        timestamp: new Date().toISOString()
      });
    }
    
    // 记录删除日志
    await database.logs().insertOne({
      type: 'donation_delete',
      targetId: id,
      deletedItem: {
        id: deletedItem?._id?.toString(),
        name: deletedItem?.name,
        project: deletedItem?.project,
        amountTWD: deletedItem?.amountTWD
      },
      deletedCount: result.deletedCount,
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      admin: true
    });
    
    res.json({
      success: true,
      message: '记录已删除',
      deletedCount: result.deletedCount,
      deletedItem: {
        id: deletedItem?._id?.toString(),
        name: deletedItem?.name,
        project: deletedItem?.project
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('删除数据错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 批量删除数据
router.delete('/api/donations/batch/:batchId', ensureDatabase, checkAdminAuth, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    const { batchId } = req.params;
    
    // 获取要删除的数据信息
    const itemsToDelete = await donationsCollection
      .find({ batchId })
      .toArray();
    
    if (itemsToDelete.length === 0) {
      return res.status(404).json({
        success: false,
        error: '找不到指定的批次数据',
        batchId,
        timestamp: new Date().toISOString()
      });
    }
    
    // 执行删除
    const result = await donationsCollection.deleteMany({ batchId });
    
    // 记录删除日志
    await database.logs().insertOne({
      type: 'batch_delete',
      batchId,
      deletedCount: result.deletedCount,
      items: itemsToDelete.map(item => ({
        id: item._id?.toString(),
        name: item.name,
        project: item.project,
        amountTWD: item.amountTWD
      })),
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      admin: true
    });
    
    res.json({
      success: true,
      message: `批次 ${batchId} 的数据已删除`,
      deletedCount: result.deletedCount,
      batchId,
      sampleItems: itemsToDelete.slice(0, 3).map(item => ({
        name: item.name,
        project: item.project
      })),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('批量删除错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 清空所有数据（危险操作）
router.delete('/api/donations', ensureDatabase, checkAdminAuth, async (req, res) => {
  try {
    const donationsCollection = database.donations();
    const logsCollection = database.logs();
    
    // 先获取数据统计
    const statsBefore = await donationsCollection.aggregate([
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalAmountTWD: { $sum: '$amountTWD' },
          totalAmountRMB: { $sum: '$amountRMB' }
        }
      }
    ]).toArray();
    
    const stats = statsBefore[0] || {
      totalRecords: 0,
      totalAmountTWD: 0,
      totalAmountRMB: 0
    };
    
    // 清空数据
    const result = await donationsCollection.deleteMany({});
    
    // 记录清空日志
    await logsCollection.insertOne({
      type: 'clear_all_data',
      deletedCount: result.deletedCount,
      statsBefore: stats,
      timestamp: new Date(),
      ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      admin: true,
      warning: '所有数据已被清空'
    });
    
    res.json({
      success: true,
      message: '所有数据已清空',
      deletedCount: result.deletedCount,
      statsBefore: stats,
      timestamp: new Date().toISOString(),
      warning: '此操作不可撤销，请谨慎使用'
    });
    
  } catch (error) {
    console.error('清空数据错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 获取操作日志
router.get('/api/logs', ensureDatabase, checkAdminAuth, async (req, res) => {
  try {
    const logsCollection = database.logs();
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const skip = (page - 1) * limit;
    const type = req.query.type || '';
    
    // 构建查询条件
    const query = {};
    if (type) query.type = type;
    
    // 获取日志
    const [logs, totalCount] = await Promise.all([
      logsCollection
        .find(query)
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      logsCollection.countDocuments(query)
    ]);
    
    // 统计各种类型的日志数量
    const typeStats = await logsCollection.aggregate([
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]).toArray();
    
    res.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      },
      stats: {
        byType: typeStats
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('获取日志错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ==================== 实用函数 ====================

// 转义CSV特殊字符
function escapeCSV(text) {
  if (typeof text !== 'string') {
    text = String(text || '');
  }
  // 转义双引号
  text = text.replace(/"/g, '""');
  return text;
}

// 404处理（当没有匹配的路由时）
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `找不到请求的资源: ${req.method} ${req.path}`,
    availableEndpoints: {
      GET: [
        '/health',
        '/api/info',
        '/api/test',
        '/api/donations',
        '/api/stats',
        '/api/export/csv',
        '/api/export/json'
      ],
      POST: [
        '/api/donations'
      ],
      DELETE: [
        '/api/donations/:id',
        '/api/donations/batch/:batchId',
        '/api/donations'
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;