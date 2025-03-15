import * as fs from 'fs';
import * as path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';
import sharp from 'sharp';

// 定义图片生成配置接口
interface ImageGenerationConfig {
  nftDir: string;
  outputDir: string;
  imageFormat: 'png' | 'jpg' | 'webp';
  imageQuality: number;
  startIndex: number;
  endIndex?: number;
  numThreads?: number;
  layerOrder: string[];
  metadataPath: string;
  compressionLevel?: number;
  forceRegenerate?: boolean; // 添加强制重新生成选项
}

// 定义元数据接口
interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  edition: number;
  attributes: {
    trait_type: string;
    value: string;
  }[];
}

interface CollectionMetadata {
  name: string;
  description: string;
  image: string;
  external_link: string;
  seller_fee_basis_points: number;
  fee_recipient: string;
  nfts: NFTMetadata[];
}

// 工作线程处理函数
async function workerFunction(data: {
  nftDir: string;
  outputImagesDir: string;
  layerOrder: string[];
  nfts: NFTMetadata[];
  startIdx: number;
  endIdx: number;
  imageFormat: 'png' | 'jpg' | 'webp';
  imageQuality: number;
  compressionLevel: number;
}) {
  const { 
    nftDir, 
    outputImagesDir, 
    layerOrder, 
    nfts, 
    startIdx, 
    endIdx,
    imageFormat,
    imageQuality,
    compressionLevel
  } = data;

  // 确保输出目录存在
  if (!fs.existsSync(outputImagesDir)) {
    fs.mkdirSync(outputImagesDir, { recursive: true });
  }

  // 处理分配给此线程的NFT
  for (let i = startIdx; i <= endIdx; i++) {
    if (i >= nfts.length) break;
    
    const nft = nfts[i];
    const edition = nft.edition;
    
    try {
      // 获取此NFT的所有图层
      const layers: sharp.OverlayOptions[] = [];
      
      for (let j = 0; j < layerOrder.length; j++) {
        const layerName = layerOrder[j];
        const attribute = nft.attributes.find(attr => 
          attr.trait_type.toLowerCase() === layerName.toLowerCase()
        );
        
        if (attribute) {
          const layerFilename = `${attribute.value}.png`; // 假设所有图层文件都是PNG
          const layerPath = path.join(nftDir, layerName, layerFilename);
          
          if (fs.existsSync(layerPath)) {
            layers.push({ input: layerPath });
          } else {
            console.warn(`Warning: Layer file not found: ${layerPath}`);
          }
        }
      }
      
      // 创建基础图像（使用第一个图层作为基础）
      if (layers.length > 0) {
        let baseImage = sharp(layers[0].input as string);
        
        // 合成其余图层
        if (layers.length > 1) {
          baseImage = baseImage.composite(layers.slice(1));
        }
        
        // 根据指定格式输出图像
        const outputPath = path.join(outputImagesDir, `${edition}.${imageFormat}`);
        
        switch (imageFormat) {
          case 'png':
            await baseImage
              .png({ compressionLevel })
              .toFile(outputPath);
            break;
          case 'jpg':
            await baseImage
              .jpeg({ quality: imageQuality })
              .toFile(outputPath);
            break;
          case 'webp':
            await baseImage
              .webp({ quality: imageQuality })
              .toFile(outputPath);
            break;
        }
        
        // 报告进度
        if (parentPort) {
          parentPort.postMessage({ type: 'progress', edition });
        }
      }
    } catch (error) {
      console.error(`Error generating image for NFT #${edition}:`, error);
      if (parentPort) {
        parentPort.postMessage({ type: 'error', edition, error: String(error) });
      }
    }
  }
  
  // 完成
  if (parentPort) {
    parentPort.postMessage({ type: 'done', processedCount: endIdx - startIdx + 1 });
  }
}

// 主函数：生成NFT图像
export async function generateImages(config: ImageGenerationConfig): Promise<void> {
  // 设置默认值
  const {
    nftDir,
    outputDir,
    imageFormat = 'png',
    imageQuality = 90,
    startIndex = 1,
    endIndex,
    numThreads = Math.max(1, cpus().length - 1), // 默认使用CPU核心数-1的线程
    layerOrder,
    metadataPath,
    compressionLevel = 6 // PNG压缩级别 (0-9)
  } = config;
  
  console.log(`Starting image generation with ${numThreads} threads`);
  console.log(`Image format: ${imageFormat}, Quality: ${imageQuality}`);
  console.log(`Starting from index: ${startIndex}`);
  
  // 读取元数据文件
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Metadata file not found: ${metadataPath}`);
  }
  
  const metadataContent = fs.readFileSync(metadataPath, 'utf8');
  const metadata: CollectionMetadata = JSON.parse(metadataContent);
  
  // 确保输出图像目录存在
  const outputImagesDir = path.join(outputDir, 'images');
  if (!fs.existsSync(outputImagesDir)) {
    fs.mkdirSync(outputImagesDir, { recursive: true });
  }
  
  // 确定结束索引
  const actualEndIndex = endIndex ? Math.min(endIndex, metadata.nfts.length) : metadata.nfts.length;
  
  // 验证起始索引
  if (startIndex < 1 || startIndex > metadata.nfts.length) {
    throw new Error(`Invalid startIndex: ${startIndex}. Must be between 1 and ${metadata.nfts.length}`);
  }
  
  // 调整为0索引
  const startIdx = startIndex - 1;
  const endIdx = actualEndIndex - 1;
  
  console.log(`Generating images for NFTs ${startIndex} to ${actualEndIndex} (total: ${endIdx - startIdx + 1})`);
  
  // 创建进度跟踪文件
  const progressFilePath = path.join(outputDir, 'generation_progress.json');
  const progressData = {
    startIndex,
    currentIndex: startIndex,
    endIndex: actualEndIndex,
    totalToGenerate: endIdx - startIdx + 1,
    generated: 0,
    errors: [] as { edition: number; error: string }[],
    startTime: new Date().toISOString(),
    lastUpdateTime: new Date().toISOString(),
    imageFormat,
    completed: false
  };
  
  fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
  
  // 如果是单线程模式，直接在主线程执行
  if (numThreads <= 1) {
    await workerFunction({
      nftDir,
      outputImagesDir,
      layerOrder,
      nfts: metadata.nfts,
      startIdx,
      endIdx,
      imageFormat,
      imageQuality,
      compressionLevel
    });
    
    // 更新进度文件为完成状态
    progressData.generated = endIdx - startIdx + 1;
    progressData.currentIndex = actualEndIndex;
    progressData.lastUpdateTime = new Date().toISOString();
    progressData.completed = true;
    fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
    
    console.log(`Image generation completed. Generated ${progressData.generated} images.`);
    return;
  }
  
  // 多线程模式
  return new Promise((resolve, reject) => {
    // 计算每个线程处理的NFT数量
    const totalNfts = endIdx - startIdx + 1;
    const nftsPerThread = Math.ceil(totalNfts / numThreads);
    
    let completedThreads = 0;
    let totalGenerated = 0;
    const errors: { edition: number; error: string }[] = [];
    
    // 创建并启动工作线程
    for (let i = 0; i < numThreads; i++) {
      const threadStartIdx = startIdx + (i * nftsPerThread);
      const threadEndIdx = Math.min(startIdx + ((i + 1) * nftsPerThread) - 1, endIdx);
      
      if (threadStartIdx > endIdx) continue; // 跳过不需要的线程
      
      const worker = new Worker(__filename, {
        workerData: {
          nftDir,
          outputImagesDir,
          layerOrder,
          nfts: metadata.nfts,
          startIdx: threadStartIdx,
          endIdx: threadEndIdx,
          imageFormat,
          imageQuality,
          compressionLevel
        }
      });
      
      worker.on('message', (message) => {
        if (message.type === 'progress') {
          // 更新进度
          progressData.generated++;
          progressData.currentIndex = Math.max(progressData.currentIndex, message.edition);
          progressData.lastUpdateTime = new Date().toISOString();
          
          // 每10个NFT更新一次进度文件
          if (progressData.generated % 10 === 0 || progressData.generated === progressData.totalToGenerate) {
            fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
          }
          
          // 打印进度
          if (progressData.generated % 100 === 0 || progressData.generated === progressData.totalToGenerate) {
            const percent = ((progressData.generated / progressData.totalToGenerate) * 100).toFixed(2);
            console.log(`Progress: ${progressData.generated}/${progressData.totalToGenerate} (${percent}%)`);
          }
        } else if (message.type === 'error') {
          // 记录错误
          errors.push({ edition: message.edition, error: message.error });
          progressData.errors.push({ edition: message.edition, error: message.error });
          fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
        } else if (message.type === 'done') {
          // 线程完成
          totalGenerated += message.processedCount;
          completedThreads++;
          
          // 所有线程完成
          if (completedThreads === numThreads) {
            progressData.generated = totalGenerated;
            progressData.completed = true;
            progressData.lastUpdateTime = new Date().toISOString();
            fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
            
            console.log(`Image generation completed. Generated ${totalGenerated} images.`);
            if (errors.length > 0) {
              console.log(`Encountered ${errors.length} errors during generation.`);
            }
            
            resolve();
          }
        }
      });
      
      worker.on('error', (err) => {
        console.error(`Worker error:`, err);
        errors.push({ edition: -1, error: String(err) });
        
        // 更新错误信息
        progressData.errors.push({ edition: -1, error: String(err) });
        fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
      });
      
      worker.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Worker stopped with exit code ${code}`);
        }
        
        completedThreads++;
        if (completedThreads === numThreads) {
          progressData.completed = true;
          progressData.lastUpdateTime = new Date().toISOString();
          fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
          
          resolve();
        }
      });
    }
  });
}

// 从进度文件恢复生成
export function resumeImageGeneration(config: Omit<ImageGenerationConfig, 'startIndex'>): Promise<void> {
  const progressFilePath = path.join(config.outputDir, 'generation_progress.json');
  
  // 如果设置了强制重新生成，则删除进度文件
  if (config.forceRegenerate && fs.existsSync(progressFilePath)) {
    fs.unlinkSync(progressFilePath);
    console.log('Force regenerate: Removed existing progress file.');
    return generateImages({ ...config, startIndex: 1 });
  }
  
  if (!fs.existsSync(progressFilePath)) {
    console.log('No progress file found. Starting from the beginning.');
    return generateImages({ ...config, startIndex: 1 });
  }
  
  try {
    const progressData = JSON.parse(fs.readFileSync(progressFilePath, 'utf8'));
    
    if (progressData.completed) {
      // 如果已完成但用户仍然调用了生成函数，可能是想重新生成
      console.log('Previous generation was already completed. Starting from the beginning.');
      fs.unlinkSync(progressFilePath); // 删除旧的进度文件
      return generateImages({ ...config, startIndex: 1 });
    }
    
    // 从上次的当前索引继续
    const resumeIndex = progressData.currentIndex + 1;
    console.log(`Resuming image generation from NFT #${resumeIndex}`);
    
    return generateImages({ ...config, startIndex: resumeIndex });
  } catch (error) {
    console.error('Error reading progress file:', error);
    console.log('Starting from the beginning.');
    return generateImages({ ...config, startIndex: 1 });
  }
}

// 如果这个文件被直接作为工作线程运行
if (!isMainThread && workerData) {
  workerFunction(workerData).catch(err => {
    console.error('Worker error:', err);
    if (parentPort) {
      parentPort.postMessage({ type: 'error', edition: -1, error: String(err) });
    }
  });
} 