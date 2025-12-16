const express = require('express');
const router = express.Router();
const database = require('./database');
const { ObjectId } = require('mongodb');

// 确保数据库连接
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

// 提交功课记录
router.post('/submit', ensureDatabase, async (req, res) => {
  try {
    const homeworkCollection = database.homeworkRecords();
    const record = req.body;
    
    // 验证必要字段
    if (!record.date || !record.name) {
      return res.status(400).json({
        success: false,
        error: '日期和姓名是必填项',
        timestamp: new Date().toISOString()
      });
    }
    
    const now = new Date();
    const homeworkRecord = {
      ...record,
      submitTime: now,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
      deviceId: record.deviceId || 'web',
      syncStatus: 'synced',
      // 确保数字字段是数字类型
      nineWord: parseInt(record.nineWord) || 0,
      buddhaWorship: parseInt(record.buddhaWorship) || 0,
      quietZen: parseInt(record.quietZen) || 0,
      activeZen: parseInt(record.activeZen) || 0,
      diamond: parseInt(record.diamond) || 0,
      amitabha: parseInt(record.amitabha) || 0,
      guanyin: parseInt(record.guanyin) || 0,
      puxian: parseInt(record.puxian) || 0,
      dizang: parseInt(record.dizang) || 0
    };
    
    const result = await homeworkCollection.insertOne(homeworkRecord);
    
    // 记录日志
    await database.homeworkLogs().insertOne({
      type: 'homework_submit',
      recordId: result.insertedId,
      name: record.name,
      date: record.date,
      timestamp: now,
      ip: req.ip
    });
    
    res.json({
      success: true,
      message: '功课记录提交成功',
      recordId: result.insertedId,
      timestamp: now.toISOString()
    });
    
  } catch (error) {
    console.error('提交功课记录错误:', error);
    res.status(500).json({
      success: false,
      error: error.message,
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
    
    // 格式化数据
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

// 删除功课记录
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
      
      // 经典统计
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
          totalDizang: { $sum: '$dizang' }
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
      totalDizang: 0
    };
    
    const totalClassics = classicsTotal.totalDiamond + 
                         classicsTotal.totalAmitabha + 
                         classicsTotal.totalGuanyin + 
                         classicsTotal.totalPuxian + 
                         classicsTotal.totalDizang;
    
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
    
    // 构建CSV内容
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
      '经典总数',
      '备注',
      '提交时间',
      '设备ID'
    ];
    
    let csvContent = '\uFEFF'; // UTF-8 BOM
    csvContent += headers.join(',') + '\n';
    
    records.forEach((item) => {
      const totalClassics = (item.diamond || 0) + 
                           (item.amitabha || 0) + 
                           (item.guanyin || 0) + 
                           (item.puxian || 0) + 
                           (item.dizang || 0);
      
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

module.exports = router;
