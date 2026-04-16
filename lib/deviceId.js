/**
 * js/deviceId.js
 * 设备级用户标识模块
 * 策略：优先读取 localStorage 已存 ID；首次访问则通过浏览器指纹生成并持久化。
 * 无需用户登录，跨 Tab 共享同一 ID。
 */

const DEVICE_ID_KEY = 'aok_device_id';

/**
 * 收集浏览器指纹特征，生成稳定哈希
 * 使用 canvas + 环境信息组合，在同一设备上高度稳定
 */
async function collectFingerprint() {
  const components = [];

  // 1. Canvas 指纹（GPU 渲染差异，设备间高度区分）
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('AllofKindle🔖', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('AllofKindle🔖', 4, 17);
    components.push(canvas.toDataURL());
  } catch (e) {
    components.push('canvas-blocked');
  }

  // 2. 屏幕与窗口特征
  components.push([
    screen.width,
    screen.height,
    screen.colorDepth,
    screen.pixelDepth,
    window.devicePixelRatio || 1
  ].join('x'));

  // 3. 时区
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);

  // 4. 语言
  components.push(navigator.language || navigator.userLanguage || 'unknown');

  // 5. 平台
  components.push(navigator.platform || 'unknown');

  // 6. 硬件并发数（CPU 核心数参考值）
  components.push(navigator.hardwareConcurrency || 0);

  // 7. 内存（仅 Chrome 支持）
  components.push(navigator.deviceMemory || 0);

  // 8. 字体检测（通过测量文本宽度判断字体是否存在）
  const testFonts = ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'];
  const canvas2 = document.createElement('canvas');
  const ctx2 = canvas2.getContext('2d');
  const fontResults = testFonts.map(font => {
    ctx2.font = `72px '${font}', monospace`;
    return ctx2.measureText('KindleFingerprint').width;
  });
  components.push(fontResults.join(','));

  return components.join('||');
}

/**
 * 简单哈希函数（djb2 变体）
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash & hash; // 转为 32 位整数
  }
  return Math.abs(hash).toString(36);
}

/**
 * 生成带前缀的设备 ID
 * 格式：aok_<timestamp36>_<fingerprintHash>
 */
async function generateDeviceId() {
  const fingerprint = await collectFingerprint();
  const fpHash = hashString(fingerprint);
  const timeComponent = Date.now().toString(36);
  return `aok_${timeComponent}_${fpHash}`;
}

/**
 * 获取或创建设备 ID（主入口）
 * @returns {Promise<string>} 设备唯一标识
 */
export async function getDeviceId() {
  // 优先从 localStorage 读取（同设备跨 session 持久）
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  
  if (!deviceId) {
    deviceId = await generateDeviceId();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log('[DeviceId] 新设备，已生成 ID:', deviceId);
  } else {
    console.log('[DeviceId] 已有设备 ID:', deviceId);
  }
  
  return deviceId;
}

/**
 * 重置设备 ID（用于"清除我的数据"功能）
 */
export async function resetDeviceId() {
  localStorage.removeItem(DEVICE_ID_KEY);
  return await getDeviceId();
}
