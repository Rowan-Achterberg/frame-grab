# FrameGrab · 取帧

从视频中抽取任意一帧，保存为图片。Windows 11 风格，支持 x64 与 ARM64。

## 安装

到 [Releases](../../releases/latest) 下载对应安装包并运行：

| 设备 | 安装包 |
| --- | --- |
| Intel / AMD 处理器 | `FrameGrab_x.y.z_x64-setup.exe` |
| ARM 处理器（骁龙等） | `FrameGrab_x.y.z_arm64-setup.exe` |

安装到当前用户，无需管理员权限；可在“设置 › 应用”中卸载。

## 使用

1. 拖入视频，或点“打开视频”（`Ctrl+O`）。
2. 拖动时间轴，或用 `←` `→` 逐帧定位；也可以直接在时间码框里输入时间后回车。
3. 选 PNG 或 JPG，点“保存当前帧”（`Ctrl+S`）。图片按视频原始分辨率输出。

| 按键 | 作用 |
| --- | --- |
| `空格` | 播放 / 暂停 |
| `←` `→` | 上一帧 / 下一帧 |
| `Shift` + `←` `→` | 后退 / 前进 1 秒 |
| `Home` `End` | 跳到开头 / 结尾 |
| `Ctrl+C` | 复制当前帧到剪贴板 |

解码使用系统自带的 WebView2，常见的 MP4、MOV、WebM、MKV（H.264 / HEVC / VP9 / AV1）都能打开；HEVC 需要系统已安装对应的视频扩展。

## 开发

需要 Node.js 20+ 和 Rust。

```
npm install
npm run dev      # 调试
npm run build    # 生成安装包
```

推送 `v*` 标签后，GitHub Actions 会构建两种架构的安装包并发布到 Releases。
