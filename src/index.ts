#!/usr/bin/env node

import { generateMetadata, generateFromConfig, loadConfig } from './generateMetadata';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import * as path from 'path';
import * as fs from 'fs';

// 定义参数接口
interface Arguments {
  nftDir: string;
  layerOrder: string[];
  numNfts: number;
  outputDir: string;
  collectionName: string;
  description: string;
  config?: string;
  generateIndividualFiles?: boolean;
  [x: string]: unknown;
}

// 解析命令行参数
const argv = yargs(hideBin(process.argv))
  .option('config', {
    alias: 'c',
    type: 'string',
    description: '配置文件路径',
    default: ''
  })
  .option('nftDir', {
    alias: 'd',
    type: 'string',
    description: '包含NFT图层的目录',
    default: '../nft'
  })
  .option('layerOrder', {
    alias: 'l',
    type: 'array',
    description: '图层顺序（例如："bg skin clothes hair"）',
  })
  .option('numNfts', {
    alias: 'n',
    type: 'number',
    description: '要生成的NFT数量',
  })
  .option('outputDir', {
    alias: 'o',
    type: 'string',
    description: '元数据文件的输出目录',
    default: 'metadata'
  })
  .option('collectionName', {
    type: 'string',
    description: 'NFT集合的名称',
    default: 'My NFT Collection'
  })
  .option('description', {
    type: 'string',
    description: 'NFT集合的描述',
    default: 'A collection of unique NFTs'
  })
  .option('generateIndividualFiles', {
    type: 'boolean',
    description: '是否为每个NFT生成单独的JSON文件',
    default: true
  })
  .help()
  .alias('help', 'h')
  .parseSync() as Arguments;

// 主函数
function main() {
  // 如果提供了配置文件，则从配置文件生成
  if (argv.config && argv.config.length > 0) {
    const configPath = path.resolve(argv.config);
    if (fs.existsSync(configPath)) {
      console.log(`Using config file: ${configPath}`);
      generateFromConfig(configPath);
      return;
    } else {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
  }

  // 检查必要的参数
  if (!argv.layerOrder || !argv.numNfts) {
    console.error('Error: layerOrder and numNfts are required when not using a config file');
    yargs.showHelp();
    process.exit(1);
  }

  // 从命令行参数生成
  generateMetadata({
    nftDir: argv.nftDir,
    layerOrder: argv.layerOrder,
    numNfts: argv.numNfts,
    outputDir: argv.outputDir,
    collectionName: argv.collectionName,
    description: argv.description,
    generateIndividualFiles: argv.generateIndividualFiles
  });
}

// 执行主函数
main(); 