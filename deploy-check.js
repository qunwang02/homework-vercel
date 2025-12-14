console.log('🚀 开始检查部署环境...\n');

// 检查Node.js版本
console.log('1. Node.js版本检查:');
console.log(`   版本: ${process.version}`);
console.log(`   架构: ${process.arch}`);
console.log(`   平台: ${process.platform}\n`);

// 检查环境变量
console.log('2. 环境变量检查:');
console.log(`   PORT: ${process.env.PORT || '未设置 (默认: 3000)'}`);
console.log(`   NODE_ENV: ${process.env.NODE_ENV || '未设置 (默认: development)'}`);
console.log(`   MONGODB_URI: ${process.env.MONGODB_URI ? '已设置' : '未设置'}`);

if (process.env.MONGODB_URI) {
  // 隐藏密码显示
  const maskedUri = process.env.MONGODB_URI.replace(/:[^:@]+@/, ':***@');
  console.log(`   连接字符串: ${maskedUri}`);
}
console.log('');

// 检查文件结构
console.log('3. 文件结构检查:');
const fs = require('fs');
const path = require('path');

const requiredFiles = [
  'package.json',
  'server/server.js',
  'public/index.html',
  'public/admin.html'
];

requiredFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`   ${file}: ${exists ? '✅ 存在' : '❌ 缺失'}`);
});

console.log('\n4. 依赖检查:');
try {
  const packageJson = require('./package.json');
  console.log(`   项目名称: ${packageJson.name}`);
  console.log(`   主文件: ${packageJson.main}`);
  console.log(`   依赖数量: ${Object.keys(packageJson.dependencies || {}).length}`);
} catch (error) {
  console.log(`   ❌ 无法读取package.json: ${error.message}`);
}

console.log('\n✅ 检查完成！');
console.log('\n💡 部署建议:');
console.log('   1. 确保在Render上设置了MONGODB_URI环境变量');
console.log('   2. 确保package.json中的start脚本指向正确的文件');
console.log('   3. 首次部署后可能需要几分钟才能生效');
console.log('   4. 查看Render日志以获取详细错误信息');