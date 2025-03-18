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
import config from '../config';

interface Config {
  outputDir?: string;
  batchSize?: number;
  [key: string]: any;
}

// 使用导入的配置模块
let metadataDir = config.outputDir || './metadata';
let batchSize = config.batchSize || 0;

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

  // 删除所有进度相关文件
  const progressFiles = [
    'generation_progress.json',
    'drive_upload_progress.json',
  ];
  
  for (const progressFile of progressFiles) {
    const progressFilePath = path.join(metadataDir, progressFile);
    if (fs.existsSync(progressFilePath)) {
      fs.unlinkSync(progressFilePath);
      console.log(`已删除进度文件: ${progressFile}`);
    }
  }

  // 检查是否使用批次目录结构
  if (batchSize > 0) {
    console.log(`检测到使用批次目录结构 (批次大小: ${batchSize})，清理批次子目录...`);
    // 读取metadataDir目录下的所有批次目录
    const dirEntries = fs.readdirSync(metadataDir, { withFileTypes: true });
    const batchDirs = dirEntries
      .filter(entry => entry.isDirectory() && /^\d+-\d+$/.test(entry.name))
      .map(entry => entry.name);
    
    if (batchDirs.length > 0) {
      console.log(`找到 ${batchDirs.length} 个批次目录`);
      for (const batchDir of batchDirs) {
        const fullBatchPath = path.join(metadataDir, batchDir);
        deleteDirectory(fullBatchPath);
        console.log(`已删除批次目录: ${batchDir}`);
      }
    } else {
      console.log('未找到批次目录');
    }
  } else {
    // 原始逻辑: 删除images目录和单个NFT元数据文件
    const imagesDir = path.join(metadataDir, 'images');
    if (fs.existsSync(imagesDir)) {
      deleteDirectory(imagesDir);
      console.log('已删除images目录');
    }
  
    // 删除单个NFT元数据文件（现在已经不需要了，但保留代码防止向后兼容）
    const files = fs.readdirSync(metadataDir);
    let deletedCount = 0;
  
    for (const file of files) {
      const filePath = path.join(metadataDir, file);
      
      // 跳过目录和metadata.json
      if (fs.statSync(filePath).isDirectory() || 
          file === 'metadata.json') {
        continue;
      }
      
      // 删除文件
      fs.unlinkSync(filePath);
      deletedCount++;
    }
  
    if (deletedCount > 0) {
      console.log(`已删除 ${deletedCount} 个文件`);
    }
  }
  
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