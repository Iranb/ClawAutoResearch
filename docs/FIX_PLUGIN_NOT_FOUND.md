# 🔧 修复 "plugin not found" 错误

## ❌ 问题症状

运行插件检查时提示：
```
- plugins.entries.openclaw-research: plugin not found: openclaw-research 
  (stale config entry ignored; remove it from plugins config)
```

## 🔍 问题原因

根据 [OpenClaw 官方插件文档](https://docs.openclaw.ai/plugins/building-plugins)，插件需要正确的配置才能被识别：

1. **package.json** 需要正确的 `openclaw` 字段
2. **openclaw.plugin.json** 需要 `kind` 字段
3. **入口文件** 需要正确导出

---

## ✅ 已修复的配置

### 1. package.json

**修复前**（错误）：
```json
"openclaw": {
  "pluginType": "research",
  "minOpenClawVersion": "0.1.0",
  "pluginId": "openclaw-research"
}
```

**修复后**（正确）：
```json
"openclaw": {
  "extensions": ["./dist/index.js"],
  "pluginId": "openclaw-research"
}
```

**关键变化**：
- ✅ 添加 `extensions` 字段指向编译后的入口文件
- ✅ 移除 `pluginType` 和 `minOpenClawVersion`（非必需）

---

### 2. openclaw.plugin.json

**修复前**（缺少字段）：
```json
{
  "id": "openclaw-research",
  "name": "OpenClaw Research",
  ...
}
```

**修复后**（完整）：
```json
{
  "id": "openclaw-research",
  "kind": "provider",
  "name": "OpenClaw Research",
  ...
}
```

**关键变化**：
- ✅ 添加 `kind` 字段，值为 `"provider"`（或 `"channel"` 对于频道插件）

---

## 🚀 验证修复

### 1. 重新编译插件

```bash
cd "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research"
npm run build
```

确保编译成功：
```
✓ TypeScript compilation completed
```

---

### 2. 检查符号链接

确保插件已正确链接到 OpenClaw：

```bash
ls -la ~/.openclaw/plugins/openclaw-research
```

应该显示：
```
lrwxr-xr-x  1 user  staff  90 Mar 21 18:43 
~/.openclaw/plugins/openclaw-research -> 
/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research
```

如果链接不存在，重新创建：
```bash
ln -sfn "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research" \
  ~/.openclaw/plugins/openclaw-research
```

---

### 3. 重启 OpenClaw Gateway

配置修改后必须重启：

```bash
# 完全重启
openclaw gateway stop
openclaw gateway start

# 或者
openclaw gateway restart
```

---

### 4. 验证插件加载

```bash
# 查看插件列表
openclaw plugins list

# 应该显示：
# ✓ openclaw-research (enabled)
```

```bash
# 查看插件详情
openclaw plugins inspect openclaw-research

# 应该显示插件信息而不是错误
```

```bash
# 检查插件状态
openclaw plugins status

# 应该显示插件运行正常
```

---

## 📋 完整配置检查清单

### package.json
- [x] `"type": "module"` - ESM 模块
- [x] `"main": "dist/index.js"` - 入口文件
- [x] `openclaw.extensions` - 指向编译后的文件
- [x] `openclaw.pluginId` - 插件 ID

### openclaw.plugin.json
- [x] `id` - 插件唯一标识符
- [x] `kind` - 插件类型（`"provider"` 或 `"channel"`）
- [x] `name` - 插件名称
- [x] `description` - 插件描述

### 文件系统
- [x] 插件目录存在于 `~/.openclaw/plugins/`
- [x] `dist/index.js` 文件存在（已编译）
- [x] 符号链接正确指向插件源码

---

## 🚨 其他可能的问题

### 问题 1：编译后的文件不存在

**症状**：`dist/index.js` 不存在

**解决**：
```bash
npm run build
```

---

### 问题 2：符号链接损坏

**症状**：符号链接指向错误的路径

**解决**：
```bash
# 删除旧链接
rm ~/.openclaw/plugins/openclaw-research

# 重新创建
ln -sfn "/Users/iranb/Library/Mobile Documents/com~apple~CloudDocs/OpenClawThings/openclaw-research" \
  ~/.openclaw/plugins/openclaw-research
```

---

### 问题 3：Gateway 缓存问题

**症状**：配置正确但仍然提示 plugin not found

**解决**：
```bash
# 清除缓存
rm -rf ~/.openclaw/cache

# 重启 Gateway
openclaw gateway restart
```

---

### 问题 4：配置文件格式错误

**症状**：JSON 解析错误

**验证**：
```bash
# 验证 package.json
cat package.json | jq .

# 验证 openclaw.plugin.json
cat openclaw.plugin.json | jq .
```

---

## 📚 官方文档参考

- [Building Plugins](https://docs.openclaw.ai/plugins/building-plugins) - 创建插件完整指南
- [Plugin Manifest](https://docs.openclaw.ai/plugins/manifest) - manifest 文件格式
- [Plugin Architecture](https://docs.openclaw.ai/plugins/architecture) - 插件系统架构

---

## 🎯 下一步

插件修复后，可以：

1. **测试插件功能**：
   ```bash
   openclaw agents researcher
   /research-pipeline "测试研究主题"
   ```

2. **查看插件日志**：
   ```bash
   openclaw gateway logs | grep openclaw-research
   ```

3. **开发新功能**：
   - 修改 `index.ts` 添加新工具
   - 运行 `npm run build` 重新编译
   - 重启 Gateway 即可生效（符号链接优势）

---

**最后更新**: 2026-03-21  
**修复版本**: 1.0.0
