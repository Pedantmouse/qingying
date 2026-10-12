# 轻盈计划 · Qingying

> 一个面向中式家常减脂餐与居家运动的体重管理应用。
> 可在任意手机浏览器中"添加到桌面"当 PWA 使用，也可打包成独立的安卓 APK 安装包。

**🌐 语言 / Language: [English](README.md) | 简体中文**

---

## 目录

- [项目简介](#项目简介)
- [功能一览](#功能一览)
- [AI 拍照识别热量](#ai-拍照识别热量)
- [拍照与语音](#拍照与语音)
- [打包安卓 APK](#打包安卓-apk)
- [部署为 PWA](#部署为-pwa)
- [文件结构](#文件结构)
- [安卓权限说明](#安卓权限说明)
- [隐私说明](#隐私说明)

## 项目简介

轻盈计划是一款单页网页应用，面向"吃中式家常菜也能减脂"的人群——米饭、炒菜、汤羹、饺子，
而不是沙拉和鸡胸肉。它记录你吃了什么、体重变化、今天有没有运动，内置 **100 种中式家常食物**
的数据库，计量单位统一为克。

整个应用是一个纯静态资源包（HTML + CSS + 原生 JavaScript，无构建步骤、无框架、无后端），
数据全部保存在你自己手机的浏览器本地存储（`localStorage`）中。

## 功能一览

**今日**
- 当日热量环，目标值根据你的身体数据自动计算
- 三餐、运动、体重、喝水打卡
- 今日推荐减脂餐，一键记入
- 饭点与运动时间的提醒横幅
- 语音播报 🔊 今日热量、蛋白质、体重与运动完成情况

**记餐**
- 选分类 → 选食物 → 选克数，热量与蛋白质自动换算
- 手动输入，自由填写
- AI 拍照识别（见下文）
- 原生语音输入（见下文）
- 可为某条饮食记录附上拍照凭证

**记录**
- 体重（斤）与体重趋势图
- 近 14 天摄入热量柱状图
- 按日期查看饮食历史
- 可附体重秤照片

**计划**
- 一周运动计划
- 一周减脂餐
- 个人设置（性别、年龄、身高、体重、目标体重、活动量、热量缺口）
- 备份与恢复（导出备份码）

每条食物记录都保存 **每 100 克的热量与蛋白质**，并附 50 / 100 / 150 / 200 / 300 克常用档位，
既可点选预设，也可自己输入任意克数。

## AI 拍照识别热量

自 v2.0 起，你可以对着饭菜拍一张照片，应用会把照片发给视觉大模型，返回
**食物名称、估算克数、热量与蛋白质**。你可以在弹窗里修改克数，热量会按比例自动重算，确认后再记入。

> 只有在你点击识别按钮时才会发送照片，后台不会上传任何内容。

## 拍照与语音

v2.0 把原来仅依赖网页接口的实现换成了 **Capacitor 原生插件**：

| 能力 | 实现方式 | 更换原因 |
| --- | --- | --- |
| 📷 拍照 | [`@capacitor/camera`](https://capacitorjs.com/docs/apis/camera) | HTML 的 `<input capture>` 在鸿蒙 / 华为的 WebView 中会静默失效。原生插件能可靠唤起系统相机，并提供「拍照 / 从相册选择」两个入口。 |
| 🎤 语音输入 | [`@capacitor-community/speech-recognition`](https://github.com/capacitor-community/speech-recognition) | Web Speech API 在 App 内置浏览器中不可用，按钮根本不会出现。改用原生插件调用手机系统语音引擎（鸿蒙自带，可用）。 |
| 🔊 语音播报 | Web Speech Synthesis | 所有现代浏览器都支持，无需改动。 |

语音内容会自动折算成克：说「米饭一碗」会填入 **米饭、150 克**。中文数字与量词
（碗 / 盘 / 个 / 两 / 斤 ……）按食物分类的对照表换算。

**重量单位说明：** 体重使用**斤**记录（1 斤 = 500 克）；食物重量一律使用**克**。

## 打包安卓 APK

> ⚠️ **重要：** 由于 v2.0 依赖原生插件，**PWABuilder、Bubblewrap 这类 TWA 打包工具无法产出可用
> 的 APK** —— TWA 本质仍运行在 Chrome 中，拿不到原生相机和语音能力。请使用 **Capacitor**。

### 环境要求

- Node.js 18+
- **JDK 21**（Capacitor 8 要求 Java 21 编译）
- Android SDK，需含 `platforms;android-36` 与 `build-tools;36.0.0`
- 用于签名发布包的 keystore

### 步骤

```bash
# 1. 创建 Capacitor 工程（仅首次）
mkdir qingying-android && cd qingying-android
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/android
npm install @capacitor/camera @capacitor-community/speech-recognition

# 2. 把网页资源复制进 www/，并创建 capacitor.config.json
#    （appId com.qingying.app，webDir 为 "www"，plugins.CapacitorHttp.enabled = true）

# 3. 生成安卓工程（仅首次）
npx cap add android

# 4. 同步网页资源与插件，然后编译
npx cap sync android
cd android
./gradlew assembleRelease
```

签名后的 APK 位于 `android/app/build/outputs/apk/release/app-release.apk`。

**两个必须知道的坑：**

1. **必须启用 `CapacitorHttp`**（写在 `capacitor.config.json` 里）。否则 WebView 内发起的 AI
   请求会被跨域限制（CORS）直接拦掉；原生 HTTP 层可以绕过。
2. **必须在 `AndroidManifest.xml` 中声明语音服务可见性。** Android 11+ 的包可见性限制会让系统
   语音识别服务"隐身"，需要加上：

   ```xml
   <queries>
     <intent><action android:name="android.speech.RecognitionService" /></intent>
   </queries>
   ```

   不加的话，`SpeechRecognizer` 会报告自己不可用，语音功能会静默失效。

升级版本时，除了改 `versionName`，**必须同时增大 `versionCode`**，否则安卓会拒绝覆盖安装。

## 部署为 PWA

应用不需要服务器，任意静态托管都可以。以 GitHub 为例：

**Settings → Pages → Build and deployment → Source 选 Deploy from a branch → 分支选 `main` /
`(root)`**，保存后访问 `https://<你的用户名>.github.io/qingying/`。

在安卓 Chrome 中即可通过「添加到主屏幕」像原生应用一样安装使用。

> 修改代码后，请把 `sw.js` 里的 `CACHE` 常量版本号加 1（如 `qingying-v3` → `qingying-v4`），
> 已安装的客户端才会拿到新版本。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `index.html` | 页面骨架（含照片查看器与相机 input） |
| `styles.css` | 样式（浅色/深色自动切换 + 拍照/语音/播报界面） |
| `data.js` | 食物库、运动计划、减脂餐计划 |
| `app.js` | 应用逻辑（记餐、图表、相机、语音、AI 识别） |
| `manifest.json` | PWA 安装信息与桌面快捷方式 |
| `sw.js` | Service Worker（离线可用） |
| `icons/` | 应用图标（192 / 512，含 maskable） |

## 安卓权限说明

| 权限 | 用途 |
| --- | --- |
| `CAMERA` | 📷 食物拍照凭证 / 体重秤拍照 / 运动打卡拍照 |
| `RECORD_AUDIO` | 🎤 语音输入 |
| `INTERNET` | 🤖 点击识别时把照片发送给 AI 服务 |
| `VIBRATE`、`POST_NOTIFICATIONS` | 🔔 饭点与运动提醒 |
| `WRITE_EXTERNAL_STORAGE` / `READ_EXTERNAL_STORAGE`（maxSdkVersion 32） | 💾 Android 12 及以下导出备份码到文件 |

## 隐私说明

- 所有数据——饮食、体重、运动、照片与设置——**只保存在你的设备上**（`localStorage`）。
  没有账号、没有服务器、没有统计埋点、没有遥测。
- 照片在本地压缩（最大宽度 800 px，JPEG 质量 0.7），不会离开设备；唯一例外是你主动提交
  用于 AI 识别的那一张。
- 除你主动点击需要联网的按钮外，任何数据都不会离开你的设备。

---

**English documentation: [README.md](README.md).**
