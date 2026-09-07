/**
 * electron-builder 配置（唯一来源，package.json 不再重复 build 字段）。
 *
 * 安全相关的构建期输入（环境变量）：
 * - ZENITH_UPDATE_SERVER：在线升级服务器地址（https），写入打包后 package.json 的 updateServer 字段，
 *   是客户端更新链路的信任根；渲染进程不能改写。缺省则打包产物不自动检查更新。
 * - ZENITH_WIN_PUBLISHER_NAME：Windows 代码签名证书的 Subject Name（可用逗号分隔多个），
 *   electron-updater 据此校验下载安装包的 Authenticode 签名；未配置时 electron-updater 会跳过签名校验，
 *   因此生产发布必须签名并配置本变量。签名本身由 electron-builder 的 CSC_LINK / CSC_KEY_PASSWORD 或
 *   WIN_CSC_* 环境变量完成，见 https://www.electron.build/code-signing
 */
const updateServer = (process.env.ZENITH_UPDATE_SERVER ?? '').trim();
if (updateServer && !/^https:\/\//i.test(updateServer)) {
  throw new Error('ZENITH_UPDATE_SERVER 必须是 https 地址');
}
const publisherName = (process.env.ZENITH_WIN_PUBLISHER_NAME ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.CI && updateServer && publisherName.length === 0) {
  console.warn('[electron-builder] 未设置 ZENITH_WIN_PUBLISHER_NAME：Windows 壳更新将不校验安装包签名');
}

/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.zenith.admin',
  productName: 'Zenith Admin',
  copyright: 'Copyright © 2024',
  // 与 package.json devDependencies 中的 electron 版本保持一致
  electronVersion: '44.2.0',

  icon: '../web/public/icons/icon-512.png',

  directories: {
    output: '../../dist/electron',
    buildResources: 'build',
  },

  // 打包期写入 package.json，主进程 updater 读取（见 src/updater.ts bundledUpdateServer）
  extraMetadata: updateServer ? { updateServer } : {},

  // 打包主进程编译产物，排除构建输出目录自身
  files: [
    'dist/**',
    '!dist/**/*.map',
    '!dist/win-unpacked/**',
    '!dist/mac/**',
    '!dist/linux-unpacked/**',
  ],

  // 将前端构建产物作为附加资源打包
  extraResources: [
    {
      from: '../web/dist',
      to: 'web',
      filter: ['**/*'],
    },
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: '../web/public/icons/icon-512.png',
    // electron-updater 校验安装包签名的发布者名单；为空时不校验（仅限本地调试构建）
    ...(publisherName.length > 0 ? { publisherName } : {}),
  },

  mac: {
    // electron-updater 在 macOS 上要求 zip 目标（Squirrel.Mac），dmg 仅供人工分发
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    category: 'public.app-category.business',
    icon: '../web/public/icons/icon-512.png',
  },

  linux: {
    target: [{ target: 'AppImage', arch: ['x64'] }],
    icon: '../web/public/icons/icon-512.png',
    category: 'Office',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: '../web/public/icons/icon-512.png',
    uninstallerIcon: '../web/public/icons/icon-512.png',
  },
};

module.exports = config;