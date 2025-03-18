#!/usr/bin/env node

import { generateFromConfig } from './generateMetadata';
import { generateImages, resumeImageGeneration } from './generateImages';
import * as path from 'path';
import * as fs from 'fs';

// 主函数
async function main() {
  // 使用默认配置文件路径
  const configPath = path.join(__dirname, '..', 'config.json');
  
  // 检查配置文件是否存在
  if (fs.existsSync(configPath)) {
    console.log(`使用配置文件: ${configPath}`);
    
    // 读取配置文件
    const configData = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);
    
    // 生成元数据
    console.log('开始生成元数据...');
    generateFromConfig(configPath);
    console.log('元数据生成完成！');
    
    // 如果启用了图片生成
    if (config.imageGeneration && config.imageGeneration.enabled) {
      console.log('开始生成NFT图片...');
      
      // 检查是否需要恢复之前的生成进度
      const progressFilePath = path.join(config.outputDir, 'generation_progress.json');
      const shouldResume = fs.existsSync(progressFilePath);
      
      // 设置图片生成配置
      const imageConfig = {
        nftDir: config.nftDir,
        outputDir: config.outputDir,
        imageFormat: config.imageGeneration.format || 'png',
        imageQuality: config.imageGeneration.quality || 90,
        numThreads: config.imageGeneration.numThreads || 0, // 0表示自动选择线程数
        layerOrder: config.layerOrder,
        metadataPath: path.join(config.outputDir, 'metadata.json'), // 这个路径实际上不再使用，但保留参数
        compressionLevel: config.imageGeneration.compressionLevel || 6,
        forceRegenerate: config.imageGeneration.forceRegenerate || false,
        batchSize: config.batchSize || 10000 // 添加批次大小参数
      };
      
      // 如果指定了起始索引，或者需要恢复
      if (shouldResume && !config.imageGeneration.forceRegenerate) {
        console.log('检测到之前的生成进度，尝试恢复...');
        await resumeImageGeneration(imageConfig);
      } else if (config.imageGeneration.startIndex && config.imageGeneration.startIndex > 1 && !config.imageGeneration.forceRegenerate) {
        console.log(`从指定的起始索引 ${config.imageGeneration.startIndex} 开始生成...`);
        await generateImages({
          ...imageConfig,
          startIndex: config.imageGeneration.startIndex
        });
      } else {
        console.log('从头开始生成所有图片...');
        await generateImages({
          ...imageConfig,
          startIndex: 1
        });
      }
      
      console.log('NFT图片生成完成！');
    }
  } else {
    console.error(`错误: 配置文件不存在: ${configPath}`);
    console.error(`请确保在项目根目录下有一个有效的config.json文件`);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  console.error('执行过程中发生错误:', error);
  process.exit(1);
}); 