import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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
}

interface Config extends Omit<GenerateOptions, 'numNfts'> {
  totalSupply: number;
  generateIndividualFiles: boolean;
  ipfsCidPlaceholder: string;
  royaltyPercentage: number;
  royaltyAddress: string;
}

/**
 * 从配置文件加载配置
 */
function loadConfig(configPath: string = 'config.json'): Config {
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    return JSON.parse(configData) as Config;
  } catch (error) {
    console.error(`Error loading config file: ${error}`);
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
    generateIndividualFiles = true,
    ipfsCidPlaceholder = 'YOUR_CID_HERE',
    royaltyPercentage = 5,
    royaltyAddress = '0xYOUR_WALLET_ADDRESS_HERE'
  } = options;
  
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
  
  // 创建一个数组来存储所有NFT的元数据
  const allNftsMetadata: NFTMetadata[] = [];
  
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
    
    const metadata: NFTMetadata = {
      name: `${collectionName} #${i + 1}`,
      description,
      image: `ipfs://${ipfsCidPlaceholder}/${i + 1}.png`,
      edition: i + 1,
      attributes
    };
    
    // 添加到数组中，用于集合元数据
    allNftsMetadata.push(metadata);
    
    // 如果需要生成单独的文件，则保存单个元数据到文件
    if (generateIndividualFiles) {
      fs.writeFileSync(
        path.join(outputDir, `${i + 1}.json`),
        JSON.stringify(metadata, null, 2)
      );
    }
  }
  
  // 生成集合元数据（包含所有NFT信息）
  const collectionMetadata: CollectionMetadata = {
    name: collectionName,
    description,
    image: `ipfs://${ipfsCidPlaceholder}_COLLECTION`,
    external_link: "",
    seller_fee_basis_points: royaltyPercentage * 100, // 转换百分比为基点 (5% = 500 basis points)
    fee_recipient: royaltyAddress,
    nfts: allNftsMetadata
  };
  
  // 保存集合元数据到metadata.json
  fs.writeFileSync(
    path.join(outputDir, "metadata.json"),
    JSON.stringify(collectionMetadata, null, 2)
  );
  
  console.log(`Generated metadata for ${actualNumNfts} NFTs in ${outputDir}`);
  if (generateIndividualFiles) {
    console.log(`Generated individual JSON files for each NFT`);
  }
  console.log(`Generated collection metadata in ${outputDir}/metadata.json`);
}

/**
 * 从配置文件生成元数据
 */
function generateFromConfig(configPath: string = 'config.json'): void {
  const config = loadConfig(configPath);
  
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
    royaltyAddress: config.royaltyAddress
  });
}

// 导出函数以便在其他文件中使用
export { generateMetadata, generateFromConfig, loadConfig }; 