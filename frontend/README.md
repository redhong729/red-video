# 观众端前端

基于 Next.js App Router、React 和 next-intl。当前已搭建首页骨架、搜索与分类筛选、排行榜面板、剧目预览、简体中文/英文切换，以及移动端底部导航。

## 本地运行

在仓库根目录安装依赖后运行：

    corepack pnpm frontend:dev

打开 http://127.0.0.1:3000，根路径默认跳转到英文首页 /en；简体中文首页为 /zh-CN。生产构建使用：

    corepack pnpm frontend:build

## 首页数据

首页通过单个 `GET /api/public/home?locale=en|zh-CN` 读取焦点图、热门剧集和后台人工排序的榜单；分类页继续通过 `GET /api/public/home/stories?locale=en|zh-CN` 读取完整公开目录，一级分类和二级标签通过 `GET /api/public/taxonomy?locale=en|zh-CN` 获取。标签列表排除系统标签；选中的分类与标签共同筛选短剧。点击首页、分类页卡片或焦点图“立即观看”进入独立短剧详情页；详情通过 `GET /api/public/dramas/:id?locale=en|zh-CN` 读取剧目信息、演员、已发布分集和逐集免费/积分信息，并按每 30 集分段。点击分集进入全屏播放页；支持上滑下一集、下滑上一集及播放器全屏切换。公开播放接口只允许已上架免费集，积分集显示锁定状态。底部“分类”“我的”分别导航到独立页面。接口不可用或首页暂无配置时显示空态；热门剧集请求失败时提供重试。开发时 Next.js 将 `/api/*` 转发到 `API_PROXY_TARGET`，默认目标为 `http://127.0.0.1:4000`。用户界面文案由 messages/ 管理，剧名、简介等内容字段保持业务数据原文。
