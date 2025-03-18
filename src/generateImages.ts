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
  metadataPath: string; // 这个参数保留但实际不使用
  compressionLevel?: number;
  forceRegenerate?: boolean;
  batchSize?: number;
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

// 获取包含特定NFT的批次元数据文件路径
function getBatchMetadataPath(edition: number, outputDir: string, batchSize: number): string {
  // 计算批次范围
  const batchStart = Math.floor((edition - 1) / batchSize) * batchSize + 1;
  const batchEnd = batchStart + batchSize - 1;
  const batchKey = `${batchStart}-${batchEnd}`;
  
  return path.join(outputDir, batchKey, 'metadata', 'metadata.json');
}

// 获取图片的输出路径
function getOutputPath(edition: number, outputImagesDir: string, imageFormat: string, batchSize: number = 10000): string {
  // 计算批次范围
  const batchStart = Math.floor((edition - 1) / batchSize) * batchSize + 1;
  const batchEnd = batchStart + batchSize - 1;
  const batchDir = `${batchStart}-${batchEnd}`;
  
  // 创建批次目录
  const batchPath = path.join(outputImagesDir, batchDir, 'img');
  if (!fs.existsSync(batchPath)) {
    fs.mkdirSync(batchPath, { recursive: true });
  }
  
  return path.join(batchPath, `${edition}.${imageFormat}`);
}

// 获取所有批次元数据信息
function getAllBatchMetadata(outputDir: string, batchSize: number, startIndex: number, endIndex: number): Map<number, NFTMetadata> {
  const allNfts = new Map<number, NFTMetadata>();
  const processedBatches = new Set<string>();
  
  for (let edition = startIndex; edition <= endIndex; edition++) {
    const batchStart = Math.floor((edition - 1) / batchSize) * batchSize + 1;
    const batchEnd = batchStart + batchSize - 1;
    const batchKey = `${batchStart}-${batchEnd}`;
    
    if (!processedBatches.has(batchKey)) {
      const metadataPath = path.join(outputDir, batchKey, 'metadata', 'metadata.json');
      
      if (fs.existsSync(metadataPath)) {
        try {
          const metadataContent = fs.readFileSync(metadataPath, 'utf8');
          const metadata: CollectionMetadata = JSON.parse(metadataContent);
          
          // 添加这个批次的所有NFT到映射中
          for (const nft of metadata.nfts) {
            allNfts.set(nft.edition, nft);
          }
          
          processedBatches.add(batchKey);
        } catch (error) {
          console.error(`Error reading batch metadata file ${metadataPath}:`, error);
        }
      } else {
        console.warn(`Batch metadata file not found: ${metadataPath}`);
      }
    }
  }
  
  return allNfts;
}

// 工作线程处理函数
async function workerFunction(data: {
  nftDir: string;
  outputDir: string;
  layerOrder: string[];
  startIdx: number;
  endIdx: number;
  imageFormat: 'png' | 'jpg' | 'webp';
  imageQuality: number;
  compressionLevel: number;
  batchSize: number;
}) {
  const { 
    nftDir, 
    outputDir, 
    layerOrder, 
    startIdx, 
    endIdx,
    imageFormat,
    imageQuality,
    compressionLevel,
    batchSize = 10000
  } = data;

  // 加载所有需要的NFT元数据
  const allNfts = getAllBatchMetadata(outputDir, batchSize, startIdx + 1, endIdx + 1);
  if (allNfts.size === 0) {
    console.error("No NFT metadata found in batch directories. Please generate metadata first.");
    if (parentPort) {
      parentPort.postMessage({ type: 'error', edition: -1, error: "No NFT metadata found" });
    }
    return;
  }

  // 处理分配给此线程的NFT
  for (let i = startIdx; i <= endIdx; i++) {
    const edition = i + 1;
    const nft = allNfts.get(edition);
    
    if (!nft) {
      console.warn(`Warning: No metadata found for NFT #${edition}`);
      continue;
    }
    
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
        
        // 根据指定格式输出图像到相应的批次目录
        const outputPath = getOutputPath(edition, outputDir, imageFormat, batchSize);
        
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
    numThreads = Math.max(1, cpus().length - 1),
    layerOrder,
    compressionLevel = 6,
    batchSize = 10000
  } = config;
  
  console.log(`Starting image generation with ${numThreads} threads`);
  console.log(`Image format: ${imageFormat}, Quality: ${imageQuality}`);
  console.log(`Starting from index: ${startIndex}`);
  console.log(`Using batch size: ${batchSize} images per directory`);
  
  // 确定总NFT数量和结束索引
  let totalNFTs = 0;
  let actualEndIndex = 0;
  
  // 找到所有批次目录，确定NFT总数
  const dirEntries = fs.readdirSync(outputDir, { withFileTypes: true });
  const batchDirs = dirEntries
    .filter(entry => entry.isDirectory() && /^\d+-\d+$/.test(entry.name))
    .map(entry => entry.name);
  
  // 检查每个批次目录是否有元数据文件
  for (const batchDir of batchDirs) {
    const metadataPath = path.join(outputDir, batchDir, 'metadata', 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      try {
        const metadataContent = fs.readFileSync(metadataPath, 'utf8');
        const metadata: CollectionMetadata = JSON.parse(metadataContent);
        totalNFTs += metadata.nfts.length;
        
        // 找出最大的edition
        for (const nft of metadata.nfts) {
          actualEndIndex = Math.max(actualEndIndex, nft.edition);
        }
      } catch (error) {
        console.error(`Error reading batch metadata file ${metadataPath}:`, error);
      }
    }
  }
  
  if (totalNFTs === 0) {
    console.error("No NFT metadata found in batch directories. Please generate metadata first.");
    return;
  }
  
  console.log(`Found ${totalNFTs} NFTs in metadata files`);
  
  // 根据提供的endIndex或检测到的最大edition确定实际结束索引
  if (endIndex) {
    actualEndIndex = Math.min(endIndex, actualEndIndex);
  }
  
  // 验证起始索引
  if (startIndex < 1 || startIndex > actualEndIndex) {
    throw new Error(`Invalid startIndex: ${startIndex}. Must be between 1 and ${actualEndIndex}`);
  }
  
  // 调整为0索引（内部使用）
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
    batchSize,
    completed: false
  };
  
  fs.writeFileSync(progressFilePath, JSON.stringify(progressData, null, 2));
  
  // 如果是单线程模式，直接在主线程执行
  if (numThreads <= 1) {
    await workerFunction({
      nftDir,
      outputDir,
      layerOrder,
      startIdx,
      endIdx,
      imageFormat,
      imageQuality,
      compressionLevel,
      batchSize
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
          outputDir,
          layerOrder,
          startIdx: threadStartIdx,
          endIdx: threadEndIdx,
          imageFormat,
          imageQuality,
          compressionLevel,
          batchSize
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