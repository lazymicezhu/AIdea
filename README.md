# AIdea

一个适合 macOS 本地使用的简约记事本原型。

## 使用

启动本地服务：

```sh
node server.js
```

然后打开 `http://localhost:4173/index.html`。

构建 macOS 应用：

```sh
scripts/build-macos.sh
```

构建产物位于 `dist/AIdea.app`。

已实现：

- 文字编辑
- 新建、切换和删除多篇笔记
- 左侧笔记标签支持红色角标收藏置顶
- Markdown 预览
- 通过顶部“插入”按钮添加图片、视频和其他文件
- 粘贴、拖拽插入附件
- 预览里点击图片或视频可在小/中/原始尺寸间切换
- 预览里点击普通文件附件可打开文件
- 通过“导入/导出”统一入口导入 `.md` / `.markdown` / `.txt`
- 通过“导入/导出”统一入口导出当前笔记文件夹，或导出全部笔记为 zip 压缩包，附件会一起保存，默认保存到桌面
- 1 分钟自动保存到浏览器本地存储，切换笔记和导出前会立即保存
- 设置里的专注模式：光标所在行正常显示，离该行越远越淡
- 手动上传到阿里云 OSS，或从 OSS 同步；同步时云端同名笔记覆盖本地，本地新增笔记保留

## 说明

附件会保存到项目的 `assets/` 目录，正文里写入相对路径，例如：

```md
![图片](assets/1710000000000-photo.png)
[文件.pdf](assets/1710000000001-file.pdf)
```

这避免了 base64 导致 Markdown 文件过大。后续如果需要 macOS `.app` 安装包，可以把这个界面迁移到 Electron 或 Tauri。

## 云端同步

启动服务前配置 OSS 环境变量：

```sh
export ALI_OSS_BUCKET="你的 bucket"
export ALI_OSS_REGION="cn-hangzhou"
export ALI_OSS_ACCESS_KEY_ID="你的 AccessKeyId"
export ALI_OSS_ACCESS_KEY_SECRET="你的 AccessKeySecret"
node server.js
```

也可以用 `ALI_OSS_ENDPOINT` 替代 `ALI_OSS_REGION`，例如：

```sh
export ALI_OSS_ENDPOINT="oss-cn-hangzhou.aliyuncs.com"
```

应用内点击“设置 > 云端同步”，填写账户名和 4 位数字传输密钥后手动上传或同步。
