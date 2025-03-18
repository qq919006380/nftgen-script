// 环境变量支持
import dotenv from "dotenv";
dotenv.config();

console.log(process.env.GOOGLE_CLIENT_ID);
// 配置对象
const config = {
  nftDir: "./layers",
  outputDir: "output",
  collectionName: "My NFT Collection",
  description: "A collection of unique NFTs",
  layerOrder: ["bg", "skin", "clothes", "hair", "pants", "shoes", "ball"],
  generateIndividualFiles: false,
  ipfsCidPlaceholder: "YOUR_CID_HERE",
  royaltyPercentage: 5,
  royaltyAddress: "0xYOUR_WALLET_ADDRESS_HERE",
  batchSize: 10,
  totalSupply: 20,
  skipExistingMetadata: true,
  imageGeneration: {
    enabled: true,
    format: "jpg",
    quality: 90,
    startIndex: 1,
    numThreads: 0,
    compressionLevel: 6,
    forceRegenerate: false,
  },
  googleDrive: {
    enabled: true,
    credentials: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN as string,
    },
    folderId: "1pmj4nuUL2_1_UGtvo94hPfyBzft18O8Q",
    deleteLocalAfterUpload: false,
    progressPath: "output/drive_upload_progress.json",
    maxRetries: 5,
    concurrentUploads: 3,
    chunkSize: 5242880,
  },
};

export default config;
