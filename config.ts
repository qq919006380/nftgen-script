// 环境变量支持
import dotenv from "dotenv";
dotenv.config();

// 配置对象
const config = {
  nftDir: "./layers",            // NFT图层目录，包含所有要组合的图层
  outputDir: "output",           // 输出目录，所有生成的文件将保存在这里
  collectionName: "Shennong Tribe", // NFT系列名称
  description: "A collection of unique NFTs", // NFT系列描述
  layerOrder: ["background", "body", "clothing", "effects", "jewelry", "necklace"], // 图层的顺序，从底层到顶层
  generateIndividualFiles: true, // 是否为每个NFT生成单独的JSON文件
  ipfsCidPlaceholder: "YOUR_CID_HERE", // IPFS CID占位符，上传到IPFS后需要替换
  royaltyPercentage: 5,          // 版税百分比，如5表示5%
  royaltyAddress: "0xYOUR_WALLET_ADDRESS_HERE", // 接收版税的钱包地址
  batchSize: 8888,                 // 每批次处理的NFT数量，用于目录分组
  totalSupply: 8888,               // 总共生成的NFT数量
  skipExistingMetadata: true,    // 如果元数据已存在，是否跳过生成
  
  // 图片生成配置
  imageGeneration: {
    enabled: true,               // 是否启用图片生成
    format: "png",               // 图片格式，支持png、jpg、webp
    quality: 90,                 // 图片质量，范围1-100
    startIndex: 1,               // 起始索引，从哪个编号开始生成
    numThreads: 0,               // 线程数，0表示自动选择最佳线程数
    compressionLevel: 6,         // 压缩级别，针对PNG格式，范围0-9
    forceRegenerate: false,      // 是否强制重新生成已有图片
  },
  
  // Excel元数据导出配置
  excelMetadata: {
    enabled: true,               // 是否启用Excel元数据导出
    filename: "collection_metadata.xlsx", // 导出的Excel文件名
    includeImages: true,         // 是否包含图片信息（目前仅作为设置保留）
    sheetName: "Collection Metadata", // Excel工作表名称
  },
  
  // Google Drive上传配置
  googleDrive: {
    enabled: false,              // 是否启用Google Drive上传
    credentials: {               // Google API凭证
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN as string,
    },
    folderId: "1jWNcGzsRUoroqhnCzHw-7U-u0V45oDz-", // Google Drive目标文件夹ID
    deleteLocalAfterUpload: true, // 上传后是否删除本地文件
    progressPath: "output/drive_upload_progress.json", // 上传进度文件路径
    maxRetries: 5,               // 上传失败最大重试次数
    concurrentUploads: 3,        // 并发上传数量
    chunkSize: 5242880,          // 分块上传的块大小（5MB）
  },
};

export default config;
