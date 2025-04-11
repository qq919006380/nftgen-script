import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as XLSX from 'xlsx';

// 定义类型
interface Attribute {
  trait_type: string;
  value: string;
}

interface NFTMetadata {
  name: string;
  description: string;
  image: string;
  edition: number;
  attributes: Attribute[];
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

interface GenerateOptions {
  nftDir: string;
  layerOrder: string[];
  numNfts: number;
  outputDir: string;
  collectionName: string;
  description: string;
  generateIndividualFiles?: boolean;
  ipfsCidPlaceholder?: string;
  royaltyPercentage?: number;
  royaltyAddress?: string;
  batchSize?: number; // 每个子目录的图片/元数据数量
  excelMetadata?: {
    enabled: boolean;
    filename: string;
    includeImages: boolean;
    sheetName: string;
  };
}

interface Config extends Omit<GenerateOptions, 'numNfts'> {
  totalSupply: number;
  generateIndividualFiles: boolean;
  ipfsCidPlaceholder: string;
  royaltyPercentage: number;
  royaltyAddress: string;
  batchSize?: number; // 每个子目录的图片/元数据数量
  excelMetadata?: {
    enabled: boolean;
    filename: string;
    includeImages: boolean;
    sheetName: string;
  };
}

/**
 * 从配置文件加载配置
 */
function loadConfig(configModulePath: string = '../config'): Config {
  try {
    // 直接导入配置模块
    const config = require(configModulePath).default;
    return config as Config;
  } catch (error) {
    console.error(`Error loading config module: ${error}`);
    process.exit(1);
  }
}

/**
 * 获取指定层目录中的所有PNG文件
 */
function getLayerFiles(layerDir: string): string[] {
  if (!fs.existsSync(layerDir)) {
    throw new Error(`Layer directory ${layerDir} does not exist`);
  }
  
  return fs.readdirSync(layerDir)
    .filter(file => file.toLowerCase().endsWith('.png'));
}

/**
 * 生成所有可能的组合
 */
function getAllCombinations<T>(arrays: T[][]): T[][] {
  if (arrays.length === 0) return [[]];
  
  const [first, ...rest] = arrays;
  const restCombinations = getAllCombinations(rest);
  
  return first.flatMap(item => 
    restCombinations.map(combination => [item, ...combination])
  );
}

/**
 * 随机选择指定数量的组合
 */
function getRandomCombinations<T>(combinations: T[][], count: number): T[][] {
  const shuffled = [...combinations];
  
  // Fisher-Yates 洗牌算法
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  
  return shuffled.slice(0, count);
}

/**
 * 获取元数据文件的输出路径
 */
function getMetadataOutputPath(edition: number, outputDir: string, batchSize: number = 10000): string {
  // 如果未指定批次大小或批次大小为0，直接使用原始路径
  if (!batchSize) {
    return path.join(outputDir, `${edition}.json`);
  }
  
  // 计算批次范围
  const batchStart = Math.floor((edition - 1) / batchSize) * batchSize + 1;
  const batchEnd = batchStart + batchSize - 1;
  const batchDir = `${batchStart}-${batchEnd}`;
  
  // 创建批次目录
  const batchPath = path.join(outputDir, batchDir, 'metadata');
  if (!fs.existsSync(batchPath)) {
    fs.mkdirSync(batchPath, { recursive: true });
  }
  
  return path.join(batchPath, `${edition}.json`);
}

/**
 * 生成Excel元数据文件
 */
function generateExcelMetadata(allNfts: NFTMetadata[], options: GenerateOptions): void {
  if (!options.excelMetadata?.enabled) {
    console.log('Excel元数据导出未启用');
    return;
  }

  const { filename = 'collection_metadata.xlsx', sheetName = 'Collection Metadata' } = options.excelMetadata;
  console.log(`正在生成Excel元数据，文件名: ${filename}`);

  // 准备Excel数据
  const excelData = allNfts.map(nft => {
    // 基础元数据
    const row: Record<string, any> = {
      'Name': nft.name,
      'Description': nft.description,
      'Edition': nft.edition,
      'Image URL': nft.image
    };

    // 添加属性列
    nft.attributes.forEach(attr => {
      row[attr.trait_type] = attr.value;
    });

    return row;
  });

  // 创建工作簿和工作表
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(excelData);
  
  // 设置列宽 - 根据内容自动调整
  const colWidths = Object.keys(excelData[0] || {}).map(key => ({
    wch: Math.max(
      key.length, 
      ...excelData.map(row => 
        row[key] ? String(row[key]).length : 0
      )
    )
  }));
  ws['!cols'] = colWidths;
  
  // 添加工作表到工作簿
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  
  // 保存Excel文件
  const excelPath = path.join(options.outputDir, filename);
  try {
    XLSX.writeFile(wb, excelPath);
    console.log(`Excel元数据已导出到: ${excelPath}`);
  } catch (error) {
    console.error('Excel导出失败:', error);
  }
}

/**
 * 生成NFT元数据
 */
function generateMetadata(options: GenerateOptions): void {
  const { 
    nftDir, 
    layerOrder, 
    numNfts, 
    outputDir, 
    collectionName, 
    description,
    generateIndividualFiles = false,
    ipfsCidPlaceholder = 'YOUR_CID_HERE',
    royaltyPercentage = 5,
    royaltyAddress = '0xYOUR_WALLET_ADDRESS_HERE',
    batchSize = 10000,
    excelMetadata
  } = options;
  
  console.log(`Using batch size: ${batchSize} NFTs per directory`);
  
  // 创建输出目录
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // 获取每个层的文件
  const layerFiles: Record<string, string[]> = {};
  for (const layer of layerOrder) {
    const layerPath = path.join(nftDir, layer);
    layerFiles[layer] = getLayerFiles(layerPath);
    console.log(`Found ${layerFiles[layer].length} files in layer '${layer}'`);
  }
  
  // 计算所有可能的组合
  const layerFilesArray = layerOrder.map(layer => layerFiles[layer]);
  const allCombinations = getAllCombinations(layerFilesArray);
  const totalCombinations = allCombinations.length;
  
  console.log(`Total possible combinations: ${totalCombinations}`);
  
  // 检查请求的NFT数量是否超过可能的组合数
  const actualNumNfts = Math.min(numNfts, totalCombinations);
  if (numNfts > totalCombinations) {
    console.log(`Warning: Requested ${numNfts} NFTs but only ${totalCombinations} combinations are possible`);
  }
  
  // 随机选择组合
  const selectedCombinations = getRandomCombinations(allCombinations, actualNumNfts);
  
  // 用于暂存每个批次的元数据
  const batchMetadata: Record<string, NFTMetadata[]> = {};
  
  // 收集所有NFT元数据，用于生成Excel
  const allNfts: NFTMetadata[] = [];
  
  // 为每个组合生成元数据
  for (let i = 0; i < selectedCombinations.length; i++) {
    const combination = selectedCombinations[i];
    const attributes: Attribute[] = [];
    
    for (let j = 0; j < combination.length; j++) {
      const traitFile = combination[j];
      const layerName = layerOrder[j];
      
      // 移除文件扩展名以获取特征值
      const traitValue = path.parse(traitFile).name;
      
      attributes.push({
        trait_type: layerName.charAt(0).toUpperCase() + layerName.slice(1),
        value: traitValue
      });
    }
    
    const edition = i + 1;
    
    // 计算批次信息
    const batchStart = Math.floor((edition - 1) / batchSize) * batchSize + 1;
    const batchEnd = batchStart + batchSize - 1;
    const batchKey = `${batchStart}-${batchEnd}`;
    
    // 计算图片路径，基于批次
    const imagePath = `ipfs://${ipfsCidPlaceholder}/${batchKey}/img/${edition}.png`;
    
    const metadata: NFTMetadata = {
      name: `${collectionName} #${edition}`,
      description,
      image: imagePath,
      edition,
      attributes
    };
    
    // 将元数据添加到相应批次
    if (!batchMetadata[batchKey]) {
      batchMetadata[batchKey] = [];
    }
    batchMetadata[batchKey].push(metadata);
    allNfts.push(metadata); // 添加到总列表中，用于Excel导出
    
    // 如果需要生成单独的文件，则保存单个元数据到文件（保留此功能但默认不启用）
    if (generateIndividualFiles) {
      const outputPath = getMetadataOutputPath(edition, outputDir, batchSize);
      fs.writeFileSync(
        outputPath,
        JSON.stringify(metadata, null, 2)
      );
    }
    
    // 每生成1000个打印一次进度
    if ((i + 1) % 1000 === 0 || i === selectedCombinations.length - 1) {
      console.log(`Generated metadata for ${i + 1}/${selectedCombinations.length} NFTs`);
    }
  }
  
  // 为每个批次生成一个metadata.json文件
  let totalBatches = 0;
  for (const [batchKey, nfts] of Object.entries(batchMetadata)) {
    // 为这个批次创建元数据目录
    const batchDir = path.join(outputDir, batchKey);
    const metadataDir = path.join(batchDir, 'metadata');
    if (!fs.existsSync(metadataDir)) {
      fs.mkdirSync(metadataDir, { recursive: true });
    }
    
    // 创建批次集合元数据
    const batchCollectionMetadata: CollectionMetadata = {
      name: `${collectionName} (${batchKey})`,
      description,
      image: `ipfs://${ipfsCidPlaceholder}_COLLECTION`,
      external_link: "",
      seller_fee_basis_points: royaltyPercentage * 100,
      fee_recipient: royaltyAddress,
      nfts: nfts
    };
    
    // 保存批次元数据文件
    fs.writeFileSync(
      path.join(metadataDir, "metadata.json"),
      JSON.stringify(batchCollectionMetadata, null, 2)
    );
    
    totalBatches++;
  }
  
  console.log(`Generated ${totalBatches} batch metadata files`);
  console.log(`Metadata generation completed. Total NFTs: ${actualNumNfts}`);
  
  // 生成Excel元数据
  if (excelMetadata?.enabled) {
    generateExcelMetadata(allNfts, options);
  }
}

/**
 * 从配置文件生成元数据
 */
function generateFromConfig(configModulePath: string = '../config'): void {
  const config = loadConfig(configModulePath);
  
  generateMetadata({
    nftDir: config.nftDir,
    layerOrder: config.layerOrder,
    numNfts: config.totalSupply,
    outputDir: config.outputDir,
    collectionName: config.collectionName,
    description: config.description,
    generateIndividualFiles: config.generateIndividualFiles,
    ipfsCidPlaceholder: config.ipfsCidPlaceholder,
    royaltyPercentage: config.royaltyPercentage,
    royaltyAddress: config.royaltyAddress,
    batchSize: config.batchSize,
    excelMetadata: config.excelMetadata
  });
}

// 导出函数以便在其他文件中使用
export { generateMetadata, generateFromConfig, loadConfig }; 