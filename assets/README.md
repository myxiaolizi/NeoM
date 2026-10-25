# assets — 图标源文件

由 `node scripts/make-icons.mjs` 生成，**纯 Node 实现，无原生依赖**（不需要 sharp / canvas / ImageMagick）。

```
assets/
├─ icon.svg           矢量母版（1024×1024，设计师改这个）
├─ icon.png           1024×1024 PNG（Linux / electron-builder 兜底）
├─ icon.ico           Windows 多尺寸 ICO（PNG 压缩，Vista+）
├─ icon.icns          macOS ICNS（icp4..ic10）
└─ icons/
   └─ 16/24/32/48/64/128/256/512/1024 × .png   （Linux hicolor 主题 / PWA）
```

## 设计

- 圆角方形（半径 ≈ 22.5%），Win11 Fluent 风格
- 对角渐变 `#2f6fed → #6aa6ff`（与 `web/src/styles/tokens.css` 的主色一致）
- 白色 "N" 字形（两个竖笔 + 一条斜带，矢量多边形而非字体，保证任何尺寸不糊）
- 4×4 超采样抗锯齿 + 圆角 alpha 遮罩

## 重新生成

```bash
node scripts/make-icons.mjs
# 或指定输出目录
node scripts/make-icons.mjs --out /tmp/neom-icons
```

`desktop/prepare-web.mjs` 会自动把 `icon.ico / icon.icns / icon.png / icon.svg`
复制到 `desktop/assets/`（electron-builder 的 `buildResources` 指向那里）。

## 替换为正式图标

1. 用设计稿覆盖 `assets/icon.svg`（保持 1024×1024、圆角矩形、留 10% 内边距）
2. 如果改成了位图：直接把 1024×1024 PNG 覆盖 `assets/icon.png`，
   再运行 `node scripts/make-icons.mjs` 之前先备份 —— 脚本从矢量重绘，
   位图版需要自行用工具切 ico/icns（`npx electron-icon-builder --input=... --output=...`）
3. 重新打包：`pwsh scripts/package-all.ps1 -Target win`

## 校验

ICO 内嵌 7 个尺寸（16…256），ICNS 内嵌 7 个（16…1024）。
Windows 任务栏 / 资源管理器、macOS Dock、Linux 桌面均会各自挑合适尺寸。
