/** @type {import('electron-builder').Configuration} */
const config = {
  appId: 'com.zenith.admin',
  productName: 'Zenith Admin',
  copyright: 'Copyright © 2024',
  // 与 package.json 中的 electron 版本保持一致
  electronVersion: '42.3.3',

  icon: '../web/public/icons/icon-512.png',

  directories: {
    output: '../../dist/electron',
    buildResources: 'build',
  },

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
  },

  mac: {
    target: [{ target: 'dmg', arch: ['x64', 'arm64'] }],
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
