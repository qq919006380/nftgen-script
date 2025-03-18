# NFT元数据生成工具

这是一个用TypeScript编写的NFT元数据生成工具，可以根据图层文件夹结构生成NFT元数据和图片。

## 安装

```bash
# 克隆仓库
git clone <repository-url>
cd nftgen-ts

# 安装依赖
npm install

# 构建项目
npm run build

# 全局安装（可选）
npm link
```

## 使用方法

### 通过配置文件使用

1. 编辑项目根目录下的`config.json`文件，设置您的NFT生成参数：

```json
{
  "nftDir": "./layers",
  "outputDir": "metadata",
  "collectionName": "My NFT Collection",
  "description": "A collection of unique NFTs",
  "totalSupply": 100,
  "layerOrder": ["bg", "skin", "clothes", "hair", "pants", "shoes", "ball"],
  "generateIndividualFiles": true,
  "ipfsCidPlaceholder": "YOUR_CID_HERE",
  "royaltyPercentage": 5,
  "royaltyAddress": "0xYOUR_WALLET_ADDRESS_HERE",
  "batchSize": 10000,
  "skipExistingMetadata": true,
  
  "imageGeneration": {
    "enabled": true,
    "format": "png",
    "quality": 90,
    "startIndex": 1,
    "numThreads": 0,
    "compressionLevel": 6,
    "forceRegenerate": false
  }
}
```

2. 运行生成命令：

```bash
npm run generate
```

### 配置文件参数说明

#### 基本配置

| 参数 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| nftDir | string | 包含NFT图层的目录 | ./layers |
| outputDir | string | 元数据文件的输出目录 | metadata |
| collectionName | string | NFT集合的名称 | My NFT Collection |
| description | string | NFT集合的描述 | A collection of unique NFTs |
| totalSupply | number | 要生成的NFT数量 | 100 |
| layerOrder | array | 图层顺序 | ["bg", "skin", "clothes", "hair", "pants", "shoes", "ball"] |
| generateIndividualFiles | boolean | 是否为每个NFT生成单独的JSON文件 | true |
| ipfsCidPlaceholder | string | IPFS CID占位符 | YOUR_CID_HERE |
| royaltyPercentage | number | 版税百分比 | 5 |
| royaltyAddress | string | 版税接收地址 | 0xYOUR_WALLET_ADDRESS_HERE |
| batchSize | number | 每个子目录中包含的NFT数量 | 10000 |
| skipExistingMetadata | boolean | 是否在检测到已有元数据时跳过元数据生成 | true |

#### 图片生成配置

| 参数 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| imageGeneration.enabled | boolean | 是否启用图片生成 | true |
| imageGeneration.format | string | 图片格式 (png/jpg/webp) | png |
| imageGeneration.quality | number | 图片质量 (1-100，仅适用于jpg和webp) | 90 |
| imageGeneration.startIndex | number | 起始生成索引（用于断点续传） | 1 |
| imageGeneration.numThreads | number | 使用的线程数（0表示自动） | 0 |
| imageGeneration.compressionLevel | number | PNG压缩级别 (0-9) | 6 |
| imageGeneration.forceRegenerate | boolean | 是否强制重新生成所有图片，忽略已有图片 | false |

## 项目结构

```
layers/
├── bg/         # 背景图层
├── skin/       # 皮肤图层
├── clothes/    # 衣服图层
├── hair/       # 头发图层
├── pants/      # 裤子图层
├── shoes/      # 鞋子图层
└── ball/       # 球图层

output/         # 输出目录
├── 1-10000/    # 批次目录
│   ├── img/    # 图片目录
│   │   ├── 1.png
│   │   ├── 2.png
│   │   └── ...
│   └── metadata/ # 元数据目录
│       ├── 1.json
│       ├── 2.json
│       ├── ...
│       └── metadata.json # 该批次的集合元数据
├── 10001-20000/ # 下一个批次目录
└── generation_progress.json # 生成进度文件
```

## 高级功能说明

### 批次生成

系统使用批次目录结构来组织生成的NFT，每个批次默认包含10000个NFT。可以通过`batchSize`参数自定义批次大小。批次目录格式为`startIndex-endIndex`。

### 跳过已有元数据生成

使用`skipExistingMetadata`参数可以控制程序在检测到已存在元数据文件时的行为：

- 当设置为`true`（默认）时：程序会检查输出目录中是否已经存在元数据文件，如果存在则跳过元数据生成阶段，直接使用这些已存在的元数据文件来生成图片。
- 当设置为`false`时：程序将始终重新生成元数据，即使已经存在元数据文件。

这个功能对以下情况特别有用：
- 当您想更新图片而不改变元数据时
- 当元数据已经生成但图片生成过程中断，需要继续生成图片时
- 当您需要使用不同的图片格式或质量设置重新生成图片，但保持相同的元数据时

### 生成的元数据格式

#### 批次元数据文件 (metadata.json)

每个批次目录中都会生成一个包含该批次所有NFT信息的元数据文件：

```json
{
  "name": "My NFT Collection (1-10000)",
  "description": "A collection of unique NFTs",
  "image": "ipfs://YOUR_CID_HERE_COLLECTION",
  "external_link": "",
  "seller_fee_basis_points": 500,
  "fee_recipient": "0xYOUR_WALLET_ADDRESS_HERE",
  "nfts": [
    {
      "name": "My NFT Collection #1",
      "description": "A collection of unique NFTs",
      "image": "ipfs://YOUR_CID_HERE/1-10000/img/1.png",
      "edition": 1,
      "attributes": [...]
    },
    // ... 其他NFT
  ]
}
```

#### 单个NFT元数据文件 (当generateIndividualFiles=true时)

当`generateIndividualFiles`设置为`true`时，每个NFT都会有一个单独的JSON文件：

```json
{
  "name": "My NFT Collection #1",
  "description": "A collection of unique NFTs",
  "image": "ipfs://YOUR_CID_HERE/1-10000/img/1.png",
  "edition": 1,
  "attributes": [
    {
      "trait_type": "Bg",
      "value": "bg1"
    },
    {
      "trait_type": "Skin",
      "value": "s1"
    },
    // ... 其他属性
  ]
}
```

## 断点续传功能

该工具支持断点续传功能，可以在图片生成过程中断后继续生成。断点续传有两种方式：

1. **自动恢复**：如果生成过程中断，下次运行时会自动检测到上次的进度并从中断处继续。

2. **手动设置**：可以在配置文件中设置 `imageGeneration.startIndex` 参数来指定从哪个索引开始生成。

生成进度信息保存在 `outputDir/generation_progress.json` 文件中。

## 多线程生成

该工具支持多线程生成图片，可以显著提高生成速度。可以通过 `imageGeneration.numThreads` 参数设置使用的线程数：

- 设置为 `0`：自动使用 (CPU核心数-1) 的线程数
- 设置为 `1`：使用单线程模式
- 设置为其他值：使用指定数量的线程

## 注意事项

1. 图层顺序很重要，它决定了图层的叠加顺序
2. 每个图层文件夹中的PNG文件将作为该图层的特征
3. 生成的元数据中的`image`字段包含IPFS CID占位符，需要在上传到IPFS后替换
4. 集合元数据中的`fee_recipient`字段需要替换为您的钱包地址
5. 每个生成的NFT都是唯一的，不会有重复的组合
6. 对于大规模生成（如10万张图片），建议使用多线程功能并确保有足够的磁盘空间
7. 图片生成过程中如果中断，可以通过断点续传功能继续生成
8. 如果您只想更新图片不改变元数据，请保持`skipExistingMetadata`为`true`
