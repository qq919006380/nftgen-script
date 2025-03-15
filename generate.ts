#!/usr/bin/env ts-node
import { generateFromConfig } from './src/generateMetadata';
import * as path from 'path';

// 获取配置文件路径（默认为当前目录下的config.json）
const configPath = process.argv[2] || path.join(__dirname, 'config.json');

console.log(`Using config file: ${configPath}`);

// 从配置文件生成元数据
generateFromConfig(configPath); 