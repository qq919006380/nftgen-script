#!/usr/bin/env ts-node

/**
 * 清空metadata目录的脚本
 * 用法: ts-node src/cleanMetadata.ts [--keep-metadata]
 * 选项:
 *   --keep-metadata: 保留metadata.json文件，只删除其他文件
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface Config {
  outputDir?: string;
  [key: string]: any;
}

// 读取配置文件获取metadata目录
let configPath = path.join(__dirname, '..', 'config.json');
let metadataDir = './metadata';

try {
  if (fs.existsSync(configPath)) {
    const configData = fs.readFileSync(configPath, 'utf8');
    const config: Config = JSON.parse(configData);
    metadataDir = config.outputDir || metadataDir;
  }
} catch (error) {
  console.error('读取配置文件失败:', error);
  console.log('将使用默认metadata目录:', metadataDir);
}

// 检查命令行参数
const keepMetadata = process.argv.includes('--keep-metadata');

// 创建readline接口用于用户交互
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 确认操作
rl.question(`确定要清空 ${metadataDir} 目录${keepMetadata ? '（保留metadata.json）' : ''}吗？(y/n) `, (answer: string) => {
  if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
    cleanMetadataDir();
  } else {
    console.log('操作已取消');
  }
  rl.close();
});

// 清空metadata目录的函数
function cleanMetadataDir(): void {
  if (!fs.existsSync(metadataDir)) {
    console.log(`目录 ${metadataDir} 不存在，无需清空`);
    return;
  }

  // 删除进度文件
  const progressFilePath = path.join(metadataDir, 'generation_progress.json');
  if (fs.existsSync(progressFilePath)) {
    fs.unlinkSync(progressFilePath);
    console.log('已删除生成进度文件');
  }

  // 删除images目录
  const imagesDir = path.join(metadataDir, 'images');
  if (fs.existsSync(imagesDir)) {
    deleteDirectory(imagesDir);
    console.log('已删除images目录');
  }

  // 删除单个NFT元数据文件
  const files = fs.readdirSync(metadataDir);
  let deletedCount = 0;

  for (const file of files) {
    const filePath = path.join(metadataDir, file);
    
    // 跳过目录和metadata.json（如果需要保留）
    if (fs.statSync(filePath).isDirectory() || 
        (keepMetadata && file === 'metadata.json')) {
      continue;
    }
    
    // 删除文件
    fs.unlinkSync(filePath);
    deletedCount++;
  }

  console.log(`已删除 ${deletedCount} 个文件`);
  console.log('清空操作完成');
}

// 递归删除目录及其内容
function deleteDirectory(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.statSync(curPath).isDirectory()) {
        // 递归删除子目录
        deleteDirectory(curPath);
      } else {
        // 删除文件
        fs.unlinkSync(curPath);
      }
    });
    
    // 删除空目录
    fs.rmdirSync(dirPath);
  }
} 