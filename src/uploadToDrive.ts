import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { promisify } from 'util';
import { exec } from 'child_process';

// 谷歌驱动上传配置接口
export interface GoogleDriveConfig {
  enabled: boolean;
  credentials: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  };
  folderId: string;                // Google Drive 目标文件夹ID
  deleteLocalAfterUpload: boolean; // 上传后是否删除本地文件
  progressPath: string;            // 上传进度记录文件路径
  maxRetries: number;              // 最大重试次数
  concurrentUploads: number;       // 并发上传数
  chunkSize: number;               // 分块大小 (字节)
}

// 上传进度跟踪接口
interface UploadProgress {
  lastBatchUploaded: string | null;
  uploadedFiles: Record<string, {
    driveId: string;
    path: string;
    size: number;
    uploadedAt: string;
  }>;
  failedUploads: Record<string, {
    path: string;
    attempts: number;
    lastError: string;
    lastAttempt: string;
  }>;
}

// OAuth 令牌接口
interface OAuthToken {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
  fetchTime: number;
}

let currentToken: OAuthToken | null = null;

/**
 * 获取 OAuth 访问令牌
 */
async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  // 检查当前令牌是否仍然有效
  if (currentToken && (Date.now() - currentToken.fetchTime < (currentToken.expires_in * 900))) {
    return currentToken.access_token;
  }

  return new Promise((resolve, reject) => {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const postData = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    }).toString();

    const req = https.request(
      tokenUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData)
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`获取访问令牌失败: ${res.statusCode} ${data}`));
            } else {
              const token = JSON.parse(data) as OAuthToken;
              token.fetchTime = Date.now();
              currentToken = token;
              resolve(token.access_token);
            }
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 创建或获取上传进度文件
 */
function getUploadProgress(progressPath: string): UploadProgress {
  try {
    if (fs.existsSync(progressPath)) {
      const data = fs.readFileSync(progressPath, 'utf8');
      return JSON.parse(data) as UploadProgress;
    }
  } catch (error) {
    console.warn(`读取上传进度文件失败: ${error}`);
  }

  // 如果文件不存在或解析失败，返回新的进度对象
  return {
    lastBatchUploaded: null,
    uploadedFiles: {},
    failedUploads: {}
  };
}

/**
 * 保存上传进度
 */
function saveUploadProgress(progressPath: string, progress: UploadProgress): void {
  try {
    const dir = path.dirname(progressPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf8');
  } catch (error) {
    console.error(`保存上传进度失败: ${error}`);
  }
}

/**
 * 分块上传文件到 Google Drive
 */
async function uploadFileToDrive(
  filePath: string,
  folderId: string,
  accessToken: string,
  config: GoogleDriveConfig
): Promise<string> {
  const fileName = path.basename(filePath);
  const fileSize = fs.statSync(filePath).size;
  const mimeType = fileName.endsWith('.png') 
    ? 'image/png' 
    : fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') 
      ? 'image/jpeg' 
      : 'application/octet-stream';

  // 1. 初始化上传会话
  const sessionUri = await initializeUploadSession(fileName, fileSize, mimeType, folderId, accessToken);
  
  // 2. 分块上传文件内容
  return uploadFileInChunks(filePath, fileSize, sessionUri, accessToken, config.chunkSize, config.maxRetries);
}

/**
 * 初始化可恢复上传会话
 */
async function initializeUploadSession(
  fileName: string,
  fileSize: number,
  mimeType: string,
  folderId: string,
  accessToken: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const metadata = {
      name: fileName,
      parents: [folderId]
    };

    const url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
    
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': fileSize
        }
      },
      (res) => {
        if (res.statusCode === 200) {
          const location = res.headers['location'];
          if (location) {
            resolve(location);
          } else {
            reject(new Error('初始化上传会话失败: 未收到位置头'));
          }
        } else {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            reject(new Error(`初始化上传会话失败: ${res.statusCode} ${data}`));
          });
        }
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.write(JSON.stringify(metadata));
    req.end();
  });
}

/**
 * 分块上传文件内容
 */
async function uploadFileInChunks(
  filePath: string,
  fileSize: number,
  sessionUri: string,
  accessToken: string,
  chunkSize: number,
  maxRetries: number
): Promise<string> {
  const fileId = new URL(sessionUri).searchParams.get('upload_id') || crypto.randomUUID();
  const fileStream = fs.createReadStream(filePath);

  let uploadedBytes = 0;
  let retries = 0;

  return new Promise((resolve, reject) => {
    fileStream.on('error', reject);

    const uploadNextChunk = () => {
      if (uploadedBytes >= fileSize) {
        resolve(fileId);
        return;
      }

      const end = Math.min(uploadedBytes + chunkSize, fileSize);
      const chunkStream = fs.createReadStream(filePath, { start: uploadedBytes, end: end - 1 });
      let chunkData: Buffer[] = [];

      chunkStream.on('data', (chunk) => {
        chunkData.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      chunkStream.on('end', () => {
        const chunk = Buffer.concat(chunkData);
        
        const req = https.request(
          sessionUri,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Range': `bytes ${uploadedBytes}-${end - 1}/${fileSize}`,
              'Content-Length': chunk.length.toString()
            }
          },
          (res) => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              let responseData = '';
              res.on('data', (chunk) => {
                responseData += chunk;
              });
              
              res.on('end', () => {
                uploadedBytes = end;
                retries = 0;
                
                if (uploadedBytes >= fileSize) {
                  try {
                    const response = JSON.parse(responseData);
                    resolve(response.id || fileId);
                  } catch (e) {
                    // 如果无法解析响应，但上传成功，则使用 fileId
                    resolve(fileId);
                  }
                } else {
                  uploadNextChunk();
                }
              });
            } else if (res.statusCode === 308) {
              // 308 表示部分内容已上传，但需要继续
              uploadedBytes = end;
              retries = 0;
              uploadNextChunk();
            } else if (res.statusCode === 429 || res.statusCode && res.statusCode >= 500) {
              // 处理限流和服务器错误
              if (retries < maxRetries) {
                retries++;
                const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
                console.warn(`上传被限流或服务器错误(${res.statusCode}), 将在 ${delay}ms 后重试 (${retries}/${maxRetries})`);
                setTimeout(uploadNextChunk, delay);
              } else {
                let error = '';
                res.on('data', (chunk) => {
                  error += chunk;
                });
                res.on('end', () => {
                  reject(new Error(`上传失败，已达到最大重试次数: ${res.statusCode} ${error}`));
                });
              }
            } else {
              let error = '';
              res.on('data', (chunk) => {
                error += chunk;
              });
              res.on('end', () => {
                reject(new Error(`上传失败: ${res.statusCode} ${error}`));
              });
            }
          }
        );

        req.on('error', (error) => {
          if (retries < maxRetries) {
            retries++;
            const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
            console.warn(`上传出错: ${error.message}，将在 ${delay}ms 后重试 (${retries}/${maxRetries})`);
            setTimeout(uploadNextChunk, delay);
          } else {
            reject(new Error(`上传失败，已达到最大重试次数: ${error.message}`));
          }
        });

        req.write(chunk);
        req.end();
      });

      chunkStream.on('error', (error) => {
        if (retries < maxRetries) {
          retries++;
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.warn(`读取文件块出错: ${error.message}，将在 ${delay}ms 后重试 (${retries}/${maxRetries})`);
          setTimeout(uploadNextChunk, delay);
        } else {
          reject(new Error(`读取文件块失败，已达到最大重试次数: ${error.message}`));
        }
      });
    };

    uploadNextChunk();
  });
}

/**
 * 批量上传NFT图片
 */
export async function uploadBatchToDrive(
  batchDir: string,
  config: GoogleDriveConfig
): Promise<void> {
  if (!config.enabled) {
    console.log('Google Drive 上传未启用，跳过上传');
    return;
  }

  const { credentials, folderId, progressPath, maxRetries, concurrentUploads = 3 } = config;
  
  // 获取上传进度
  const progress = getUploadProgress(progressPath);
  
  // 检查此批次是否已上传
  const batchKey = path.basename(batchDir);
  if (progress.lastBatchUploaded === batchKey) {
    console.log(`批次 ${batchKey} 已上传到 Google Drive，跳过`);
    return;
  }
  
  // 获取图片目录
  const imgDir = path.join(batchDir, 'img');
  if (!fs.existsSync(imgDir)) {
    console.error(`批次图片目录不存在: ${imgDir}`);
    return;
  }
  
  // 获取当前批次中的所有图片
  const files = fs.readdirSync(imgDir)
    .filter(file => file.match(/\.(png|jpg|jpeg)$/i))
    .map(file => path.join(imgDir, file));
  
  if (files.length === 0) {
    console.log(`批次 ${batchKey} 中没有找到图片，跳过上传`);
    return;
  }
  
  console.log(`开始上传批次 ${batchKey} 中的 ${files.length} 个文件到 Google Drive...`);
  
  // 获取访问令牌
  let accessToken: string;
  try {
    accessToken = await getAccessToken(
      credentials.clientId,
      credentials.clientSecret, 
      credentials.refreshToken
    );
  } catch (error) {
    console.error(`获取 Google Drive 访问令牌失败: ${error}`);
    return;
  }
  
  // 创建批次文件夹
  const batchFolderId = await createOrGetBatchFolder(batchKey, folderId, accessToken, maxRetries);
  
  // 并发上传文件
  const uploadResults = [];
  
  // 准备要上传的文件列表，排除已上传的文件
  const filesToUpload = files.filter(file => {
    const fileName = path.basename(file);
    return !progress.uploadedFiles[fileName];
  });
  
  console.log(`批次 ${batchKey} 中有 ${filesToUpload.length} 个文件需要上传...`);
  
  // 使用并发池限制并发上传数量
  for (let i = 0; i < filesToUpload.length; i += concurrentUploads) {
    const batch = filesToUpload.slice(i, i + concurrentUploads);
    
    // 并发上传当前批次
    const promises = batch.map(async (file) => {
      const fileName = path.basename(file);
      
      // 检查是否已上传或之前上传失败
      if (progress.uploadedFiles[fileName]) {
        console.log(`文件 ${fileName} 已上传，跳过`);
        return { file, success: true, driveId: progress.uploadedFiles[fileName].driveId };
      }
      
      let retryCount = 0;
      const failRecord = progress.failedUploads[fileName];
      if (failRecord) {
        retryCount = failRecord.attempts;
        console.log(`尝试重新上传先前失败的文件 ${fileName} (尝试次数: ${retryCount})`);
      }
      
      try {
        console.log(`上传文件 ${fileName} 到 Google Drive...`);
        const driveId = await uploadFileToDrive(file, batchFolderId, accessToken, config);
        
        // 记录上传成功
        progress.uploadedFiles[fileName] = {
          driveId,
          path: file,
          size: fs.statSync(file).size,
          uploadedAt: new Date().toISOString()
        };
        
        // 从失败列表中移除
        if (progress.failedUploads[fileName]) {
          delete progress.failedUploads[fileName];
        }
        
        // 如果配置为上传后删除本地文件
        if (config.deleteLocalAfterUpload) {
          try {
            fs.unlinkSync(file);
            console.log(`已从本地删除文件 ${fileName}`);
          } catch (error) {
            console.warn(`删除本地文件 ${fileName} 失败: ${error}`);
          }
        }
        
        return { file, success: true, driveId };
      } catch (error) {
        console.error(`上传文件 ${fileName} 失败: ${error}`);
        
        // 记录失败信息
        progress.failedUploads[fileName] = {
          path: file,
          attempts: retryCount + 1,
          lastError: error instanceof Error ? error.message : String(error),
          lastAttempt: new Date().toISOString()
        };
        
        return { file, success: false, error };
      }
    });
    
    const results = await Promise.all(promises);
    uploadResults.push(...results);
    
    // 每批次上传后保存进度
    saveUploadProgress(progressPath, progress);
    
    // 如果批次全部上传成功，更新最后上传的批次
    const allBatchFilesUploaded = files.every(file => {
      const fileName = path.basename(file);
      return progress.uploadedFiles[fileName];
    });
    
    if (allBatchFilesUploaded) {
      progress.lastBatchUploaded = batchKey;
    }
    
    // 每批次添加小延迟，避免过快触发 API 限制
    if (i + concurrentUploads < filesToUpload.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // 保存最终进度
  saveUploadProgress(progressPath, progress);
  
  // 统计上传结果
  const successCount = uploadResults.filter(r => r.success).length;
  const failCount = uploadResults.filter(r => !r.success).length;
  
  console.log(`批次 ${batchKey} 上传完成: ${successCount} 成功, ${failCount} 失败`);
  
  // 如果所有文件上传成功，更新最后上传的批次
  if (failCount === 0) {
    progress.lastBatchUploaded = batchKey;
    saveUploadProgress(progressPath, progress);
  }
}

/**
 * 创建或获取 Google Drive 中的批次文件夹
 */
async function createOrGetBatchFolder(
  batchName: string, 
  parentFolderId: string, 
  accessToken: string,
  maxRetries: number
): Promise<string> {
  // 首先检查文件夹是否已存在
  const existingFolderId = await findFolder(batchName, parentFolderId, accessToken);
  if (existingFolderId) {
    return existingFolderId;
  }

  // 如果文件夹不存在，创建新文件夹
  return new Promise((resolve, reject) => {
    const url = 'https://www.googleapis.com/drive/v3/files';
    const folderMetadata = {
      name: batchName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId]
    };

    let retries = 0;
    const createFolder = () => {
      const req = https.request(
        url,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const response = JSON.parse(data);
                resolve(response.id);
              } catch (error) {
                reject(new Error(`解析创建文件夹响应失败: ${error}`));
              }
            } else if (res.statusCode === 429 || (res.statusCode && res.statusCode >= 500)) {
              // 处理限流和服务器错误
              if (retries < maxRetries) {
                retries++;
                const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
                console.warn(`创建文件夹被限流或服务器错误(${res.statusCode})，将在 ${delay}ms 后重试 (${retries}/${maxRetries})`);
                setTimeout(createFolder, delay);
              } else {
                reject(new Error(`创建文件夹失败，已达到最大重试次数: ${res.statusCode} ${data}`));
              }
            } else {
              reject(new Error(`创建文件夹失败: ${res.statusCode} ${data}`));
            }
          });
        }
      );

      req.on('error', (error) => {
        if (retries < maxRetries) {
          retries++;
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.warn(`创建文件夹网络错误: ${error.message}，将在 ${delay}ms 后重试 (${retries}/${maxRetries})`);
          setTimeout(createFolder, delay);
        } else {
          reject(new Error(`创建文件夹失败，已达到最大重试次数: ${error.message}`));
        }
      });

      req.write(JSON.stringify(folderMetadata));
      req.end();
    };

    createFolder();
  });
}

/**
 * 在 Google Drive 中查找指定名称的文件夹
 */
async function findFolder(
  folderName: string, 
  parentFolderId: string, 
  accessToken: string
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const query = encodeURIComponent(`name='${folderName}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`;

    const req = https.request(
      url,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              if (response.files && response.files.length > 0) {
                resolve(response.files[0].id);
              } else {
                resolve(null); // 没有找到文件夹
              }
            } catch (error) {
              reject(new Error(`解析查找文件夹响应失败: ${error}`));
            }
          } else {
            reject(new Error(`查找文件夹失败: ${res.statusCode} ${data}`));
          }
        });
      }
    );

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * 上传全部批次到 Google Drive
 */
export async function uploadAllBatchesToDrive(
  outputDir: string, 
  config: GoogleDriveConfig
): Promise<void> {
  if (!config.enabled) {
    console.log('Google Drive 上传未启用，跳过上传');
    return;
  }

  console.log('开始上传所有批次到 Google Drive...');

  try {
    // 获取所有批次目录
    const dirEntries = fs.readdirSync(outputDir, { withFileTypes: true });
    const batchDirs = dirEntries
      .filter(entry => entry.isDirectory() && /^\d+-\d+$/.test(entry.name))
      .map(entry => path.join(outputDir, entry.name))
      .sort(); // 确保按顺序处理批次
    
    if (batchDirs.length === 0) {
      console.log('没有找到批次目录');
      return;
    }
    
    console.log(`找到 ${batchDirs.length} 个批次目录`);
    
    // 获取上传进度
    const progress = getUploadProgress(config.progressPath);
    
    // 按顺序上传每个批次
    for (const batchDir of batchDirs) {
      const batchKey = path.basename(batchDir);
      
      // 跳过已上传的批次
      if (progress.lastBatchUploaded === batchKey) {
        console.log(`批次 ${batchKey} 已上传，跳过`);
        continue;
      }
      
      await uploadBatchToDrive(batchDir, config);
    }
    
    console.log('所有批次上传完成!');
  } catch (error) {
    console.error('上传批次时出错:', error);
  }
}

/**
 * 创建OAuth凭证和访问权限的帮助函数
 */
export async function setupGoogleDriveAuth(): Promise<void> {
  console.log(`
=== 设置 Google Drive API 访问 ===

请按照以下步骤操作:

1. 前往 Google Cloud Console: https://console.cloud.google.com/
2. 创建一个新项目或选择现有项目
3. 启用 Google Drive API
4. 创建 OAuth 凭证:
   - 创建 OAuth 客户端 ID
   - 应用类型选择"桌面应用"
   - 下载 JSON 凭证文件
5. 将凭证文件重命名为 'credentials.json' 并放在应用根目录下
6. 运行以下命令获取刷新令牌:
   node -e "require('./src/uploadToDrive').getRefreshToken()"
7. 按照控制台说明获取授权码
8. 将生成的客户端ID、客户端密钥和刷新令牌添加到 config.ts 文件中
`);
}

/**
 * 获取刷新令牌的辅助函数
 */
export async function getRefreshToken(): Promise<void> {
  try {
    let credentials: any;
    
    try {
      const credentialsPath = path.join(process.cwd(), 'credentials.json');
      credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    } catch (error) {
      console.error('无法读取 credentials.json 文件:', error);
      console.log('请确保已下载 OAuth 凭证并将其重命名为 "credentials.json" 放在项目根目录。');
      return;
    }
    
    const clientId = credentials.installed.client_id;
    const clientSecret = credentials.installed.client_secret;
    const redirectUri = credentials.installed.redirect_uris[0];
    
    // 创建授权URL
    const authUrl = `https://accounts.google.com/o/oauth2/auth?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent('https://www.googleapis.com/auth/drive')}` +
      `&response_type=code` +
      `&access_type=offline` +
      `&prompt=consent`;
    
    console.log('\n请在浏览器中打开以下链接进行授权:');
    console.log(authUrl);
    console.log('\n授权后，您将被重定向到一个带有授权码的页面。');
    
    // 使用 readline 或其他方式获取用户输入的授权码
    const { default: readline } = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('\n请输入授权码: ', async (code) => {
      try {
        // 使用授权码获取令牌
        const tokenUrl = 'https://oauth2.googleapis.com/token';
        const tokenData = {
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code'
        };
        
        const execPromise = promisify(exec);
        const curlCommand = `curl -s --request POST --data "${Object.entries(tokenData).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}" ${tokenUrl}`;
        
        const { stdout } = await execPromise(curlCommand);
        const tokenResponse = JSON.parse(stdout);
        
        if (tokenResponse.error) {
          console.error('获取令牌失败:', tokenResponse.error_description || tokenResponse.error);
        } else {
          console.log('\n成功获取令牌!');
          console.log('\n请将以下信息添加到 config.ts 文件:');
          console.log(`
"googleDrive": {
  "enabled": true,
  "credentials": {
    "clientId": "${clientId}",
    "clientSecret": "${clientSecret}",
    "refreshToken": "${tokenResponse.refresh_token}"
  },
  "folderId": "YOUR_FOLDER_ID_HERE",
  "deleteLocalAfterUpload": false,
  "progressPath": "output/drive_upload_progress.json",
  "maxRetries": 5,
  "concurrentUploads": 3,
  "chunkSize": 5242880
}
`);
        }
      } catch (error) {
        console.error('处理授权码时出错:', error);
      } finally {
        rl.close();
      }
    });
  } catch (error) {
    console.error('设置 Google Drive 授权过程中出错:', error);
  }
} 