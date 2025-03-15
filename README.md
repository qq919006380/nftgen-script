# NFT元数据生成工具

这是一个用TypeScript编写的NFT元数据生成工具，可以根据图层文件夹结构生成NFT元数据。

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

### 通过配置文件使用（推荐）

1. 编辑`config.json`文件，设置您的NFT生成参数：

```json
{
  "nftDir": "../nft",
  "outputDir": "metadata",
  "collectionName": "My NFT Collection",
  "description": "A collection of unique NFTs",
  "totalSupply": 100,
  "layerOrder": ["bg", "skin", "clothes", "hair", "pants", "shoes", "ball"],
  "generateIndividualFiles": true,
  "ipfsCidPlaceholder": "YOUR_CID_HERE",
  "royaltyPercentage": 5,
  "royaltyAddress": "0xYOUR_WALLET_ADDRESS_HERE"
}
```

2. 运行生成命令：

```bash
npm run generate:config
```

3. 如果您想使用自定义配置文件路径：

```bash
npm run generate:config -- /path/to/your/config.json
```

### 配置文件参数说明

| 参数 | 类型 | 描述 | 默认值 |
|------|------|------|--------|
| nftDir | string | 包含NFT图层的目录 | ../nft |
| outputDir | string | 元数据文件的输出目录 | metadata |
| collectionName | string | NFT集合的名称 | My NFT Collection |
| description | string | NFT集合的描述 | A collection of unique NFTs |
| totalSupply | number | 要生成的NFT数量 | 100 |
| layerOrder | array | 图层顺序 | ["bg", "skin", "clothes", "hair", "pants", "shoes", "ball"] |
| generateIndividualFiles | boolean | 是否为每个NFT生成单独的JSON文件 | true |
| ipfsCidPlaceholder | string | IPFS CID占位符 | YOUR_CID_HERE |
| royaltyPercentage | number | 版税百分比 | 5 |
| royaltyAddress | string | 版税接收地址 | 0xYOUR_WALLET_ADDRESS_HERE |

### 命令行使用（高级）

```bash
# 使用ts-node运行
npm run generate -- --layerOrder bg skin clothes hair pants shoes ball --numNfts 100

# 如果全局安装了，可以直接使用
nftgen --layerOrder bg skin clothes hair pants shoes ball --numNfts 100
```

### 命令行参数说明

| 参数 | 简写 | 类型 | 描述 | 默认值 |
|------|------|------|------|--------|
| --nftDir | -d | string | 包含NFT图层的目录 | ../nft |
| --layerOrder | -l | array | 图层顺序（例如："bg skin clothes hair"） | 必填 |
| --numNfts | -n | number | 要生成的NFT数量 | 必填 |
| --outputDir | -o | string | 元数据文件的输出目录 | metadata |
| --collectionName | -c | string | NFT集合的名称 | My NFT Collection |
| --description | | string | NFT集合的描述 | A collection of unique NFTs |
| --generateIndividualFiles | | boolean | 是否为每个NFT生成单独的JSON文件 | true |

## 项目结构

```
nft/
├── bg/         # 背景图层
├── skin/       # 皮肤图层
├── clothes/    # 衣服图层
├── hair/       # 头发图层
├── pants/      # 裤子图层
├── shoes/      # 鞋子图层
└── ball/       # 球图层
```

## 生成的元数据格式

### 集合元数据文件 (metadata.json)

无论配置如何，都会生成一个包含所有NFT信息的集合元数据文件：

```json
{
  "name": "My NFT Collection",
  "description": "A collection of unique NFTs",
  "image": "ipfs://YOUR_CID_HERE_COLLECTION",
  "external_link": "",
  "seller_fee_basis_points": 500,
  "fee_recipient": "0xYOUR_WALLET_ADDRESS_HERE",
  "nfts": [
    {
      "name": "My NFT Collection #1",
      "description": "A collection of unique NFTs",
      "image": "ipfs://YOUR_CID_HERE/1.png",
      "edition": 1,
      "attributes": [...]
    },
    {
      "name": "My NFT Collection #2",
      "description": "A collection of unique NFTs",
      "image": "ipfs://YOUR_CID_HERE/2.png",
      "edition": 2,
      "attributes": [...]
    },
    ...
  ]
}
```

### 单个NFT元数据文件 (当generateIndividualFiles=true时)

当`generateIndividualFiles`设置为`true`时，每个NFT都会有一个单独的JSON文件：

```json
{
  "name": "My NFT Collection #1",
  "description": "A collection of unique NFTs",
  "image": "ipfs://YOUR_CID_HERE/1.png",
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
    ...
  ]
}
```

## 注意事项

1. 图层顺序很重要，它决定了图层的叠加顺序
2. 每个图层文件夹中的PNG文件将作为该图层的特征
3. 生成的元数据中的`image`字段包含IPFS CID占位符，需要在上传到IPFS后替换
4. 集合元数据中的`fee_recipient`字段需要替换为您的钱包地址
5. 每个生成的NFT都是唯一的，不会有重复的组合 # nftgen-script
