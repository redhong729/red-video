# 本地数据库与 API

当前已实现管理员登录、服务端会话、剧目草稿 API、剧集管理、批量上传与媒体处理、首页运营配置和观众端公开目录 API。

## 已验证的环境

- Node.js 24.22.3，通过 Corepack 使用项目指定的 pnpm 10.34.8。
- 本机 PostgreSQL 18.7，Homebrew 服务 `postgresql@18`，数据库 `red_video`，项目账号 `red_video`，监听本机 5432 端口。
- Prisma 7.10.1；迁移及客户端生成使用同一版本。

## 在另一台本地开发机上准备

1. 安装并启动 PostgreSQL 18，创建项目专用登录角色和由该角色拥有的 `red_video` 数据库。不要使用生产数据库。角色和数据库不存在时，可通过具备管理权限的 PostgreSQL 账号执行以下示例：

   ```sql
   CREATE ROLE red_video LOGIN PASSWORD 'local_dev_password';
   CREATE DATABASE red_video OWNER red_video;
   ```

2. 将 `backend/api/.env.example` 复制为 `backend/api/.env`，按本机实际账号、密码、端口修改 `DATABASE_URL`。示例密码只用于本地开发；`.env` 不应提交。特殊字符须按 URL 编码。
3. 在仓库根目录执行：

   ```sh
   corepack pnpm install --frozen-lockfile
   corepack pnpm db:migrate
   corepack pnpm db:generate
   corepack pnpm db:status
   ```

`db:migrate` 应用已提交的迁移，`db:status` 检查迁移状态。客户端生成文件不提交，需要本地执行 `db:generate`。

当前机器的 Homebrew PostgreSQL 初始化时对本地连接启用了 trust 认证，示例密码不能作为本机数据库访问保护；服务仅供本地开发，后续部署必须单独配置认证和网络访问。运行 `brew services start postgresql@18` 可启动服务并在登录后自动启动；`brew services stop postgresql@18` 可停止。管理页面的启动方法见 [后台管理页面说明](../admin/README.md)。

## 运行 API

完成上面的数据库准备后，在仓库根目录运行：

```sh
corepack pnpm api:build
corepack pnpm api:start
```

服务默认只监听 `127.0.0.1:4000`，可在 `backend/api/.env` 中通过 `PORT` 修改端口。数据库地址通过同一文件的 `DATABASE_URL` 配置；启动时会检查数据库连接。按 `Ctrl+C` 停止服务。修改代码或数据库模型后需要重新构建；`api:build` 会先重新生成 Prisma Client。

## 管理员和会话

本机已创建用户名为 `admin` 的本地管理员；随机初始密码仅保存在本机 `backend/api/.admin-credentials` 中，文件仅当前用户可读且被忽略，不提交到仓库。请妥善保存密码，确认保存后可删除该文件。

在新环境完成数据库迁移和 `corepack pnpm api:build` 后，在终端执行 `corepack pnpm admin:create-user` 创建首个管理员；命令仅在没有管理员时执行，并在终端一次性显示随机密码。请勿把输出提交到仓库或分享。该命令不是公开注册接口，也不会覆盖已有账号。

- 会话存于 PostgreSQL，Cookie 为 HttpOnly、SameSite=Strict；令牌在数据库中只保存哈希，有效期 12 小时，退出立即失效。
- 除登录接口外，当前 API 默认要求登录。登录和退出等非只读请求必须携带与 `ADMIN_ORIGIN` 完全一致的 Origin；默认是 `http://127.0.0.1:3001`。如修改主机或端口，请同步修改 `backend/api/.env` 中该值并重启 API；`localhost` 和 `127.0.0.1` 不等价。
- 本地登录限制为同一来源地址 10 分钟最多 10 次尝试，成功后清除计数；计数仅在当前 API 进程内，重启后重置，不适用于多实例或公开部署。
- 当前仅支持本地首个管理员的初始化与登录，不含账号管理、改密或细分角色。上线前需另外完善账号恢复、权限划分、生产级限流、HTTPS 和数据库认证。

已构建并启动 API 后，可运行 `TEST_API_URL=http://127.0.0.1:4000 corepack pnpm --filter @red-video/api test`。集成测试使用并清理自动生成的临时账号，不修改管理员账号。

## 剧目草稿 API

以下接口均需管理员会话；写操作沿用 Origin 校验：

- `GET /api/dramas`：分页及关键词、分类、标签、状态、付费策略、更新时间筛选；多个标签按任一命中，其他条件组合为交集。
- `GET /api/dramas/options?locale=zh-CN`：读取分类与标签选项；缺少当前语言的分类或标签名称时返回空值，不猜测其回退规则。
- `POST /api/dramas`、`GET /api/dramas/:id`、`PUT /api/dramas/:id`：创建、读取和更新草稿；服务端要求至少一个有效标题并校验数值及关联。

草稿列表标题优先使用请求语言、其次英文；草稿可能没有英文标题，此时使用已有的任一标题以便识别。分类与标签通过管理界面维护。

## 剧集管理 API

`GET /api/dramas/:dramaId/episodes` 返回当前短剧的分页剧集列表、默认/自定义标题和按剧级及单集配置计算的价格、试看配置；`POST /api/dramas/:dramaId/episodes` 创建条目，`PUT /api/dramas/:dramaId/episodes/:episodeId` 编辑配置；列表固定按集号升序。均需要管理员会话，写操作校验来源。

集号不可重复或超过计划总集数；已有集号不能通过编辑改写，总集数不能清空或低于已有最大集号。已存在的历史手动排序数据会保留，但不会影响列表顺序。显式免费/积分优先于剧级策略；单集试看 `null` 表示跟随，`0` 表示关闭。接口编辑待发布草稿；已发布快照不随编辑改变。


## 媒体 API 和处理进程

媒体接口需要管理员会话，写操作校验来源。`GET /api/media/config` 读取限制并报告媒体处理进程是否在线，`GET/POST /api/media/batches` 查询或创建批次；文件分片使用 `PUT /api/media/items/:id/chunks/:number`，完成上传使用 `POST /api/media/items/:id/complete`。批次支持取消和失败重试；素材接口提供受保护的视频预览、封面候选、截帧、选择以及试看重新生成。处理由独立的 `corepack pnpm media:worker` 执行，不依赖页面保持打开。

环境参数、运行步骤、默认限制、存储保留和测试方法见 [本地媒体处理](../../docs/local-media.md)。素材操作支持草稿与已发布剧目的修改稿。观众端已通过公开接口展示详情并播放已上架的免费分集；账号、付费解锁与支付尚未接入。


## 分类和标签管理 API

`GET/POST /api/taxonomy/categories` 和 `/api/taxonomy/tags` 查询和新增；`PUT /api/taxonomy/:kind/:id` 更新多语言名称，`PUT /api/taxonomy/:kind/:id/status` 启停，`DELETE /api/taxonomy/:kind/:id` 删除。`kind` 仅支持 `categories` 和 `tags`。写操作需要管理员会话并校验 Origin。

每个条目至少有一种语言的名称；同类同语言的名称忽略首尾空格和英文字母大小写去重，由数据库唯一索引保护。停用不移除历史关联，保留剧目筛选；不可新关联已停用项，剧目保留原有关联仍可保存。只有未被剧目引用的条目可删除。选项接口仍按请求语言返回名称，缺失时不做语言回退。

-首页焦点图由“首页运营”配置，不再使用“焦点图”系统标签。`GET /api/public/home/featured?locale=zh-CN|en` 无需登录，按已保存配置的顺序返回最多 10 条，包含标题、简介、分类名、已上架集数、计划总集数、封面地址和发布时间；尚未保存配置时返回空列表。`GET /api/public/taxonomy?locale=zh-CN|en` 返回后台已启用的分类和普通标签，排除系统标签。`GET /api/public/home/stories?locale=zh-CN|en` 返回有已上架分集的公开短剧目录，最多 100 条，附带分类 ID、标签 ID 和显示名称；已删除或系统标签不会从旧发布快照中输出。`GET /api/public/dramas/:id?locale=zh-CN|en` 返回已上架剧目详情、演员姓名与角色、已发布集数及逐集免费/积分信息；`GET /api/public/dramas/:dramaId/episodes/:episodeId/video` 支持 Range 分段读取已上架免费集，积分集返回 403，剧目/分集下架或媒体无效时返回 404。这些接口返回的封面都通过公开的 `GET /api/public/dramas/:id/cover` 读取；剧目下架或没有已发布封面时封面接口返回 404。
登录后台后，“首页运营”页可选择已上架且至少有一集上架的短剧，分别维护焦点图（最多 10 部）、热门剧集（最多 12 部）和榜单（最多 10 部）的顺序。`GET /api/home-operations?locale=zh-CN|en` 读取候选剧目与配置，`PUT /api/home-operations` 保存三个剧目 ID 有序数组，需要管理员会话和有效 Origin。榜单暂为人工顺序，不生成虚假热度数据。

观众首页用单个无需登录的 `GET /api/public/home?locale=zh-CN|en` 获取 `featured.items`、`popular.items` 和 `ranking.items`；榜单条目含 `rank`，区块带 `updatedAt`。已保存配置会严格按后台顺序输出，剧目或分集下架后会从公开结果中自动移除；未配置时焦点图和榜单为空，热门取公开剧目列表。旧 `GET /api/public/home/featured` 继续兼容并读取同一份已保存配置。`GET /api/public/taxonomy?locale=zh-CN|en` 返回已启用分类和普通标签，排除系统标签；`GET /api/public/home/stories?locale=zh-CN|en` 返回有已上架分集的公开目录，最多 100 条，供分类页使用。`GET /api/public/dramas/:id?locale=zh-CN|en` 返回剧目详情、演员姓名与角色、已发布集数及逐集免费/积分信息；`GET /api/public/dramas/:dramaId/episodes/:episodeId/video` 支持 Range 分段读取已上架免费集，积分集返回 403，剧目/分集下架或媒体无效时返回 404。公开封面通过 `GET /api/public/dramas/:id/cover` 读取；剧目下架或没有已发布封面时返回 404。

`GET /api/public/search?locale=zh-CN|en&q=关键词` 无需登录，按剧名、简介、演员、分类和普通标签进行包含式模糊匹配；多个空格分隔的关键词需同时命中，剧名命中优先排序。结果只包含有已上架分集的公开短剧。


## 短剧封面 API

`POST /api/drama-cover-staging` 可在草稿创建前上传封面，接收原始图片数据，Content-Type 为 `image/jpeg`、`image/png` 或 `image/webp`，最大 10 MiB；图片经 ffprobe 与 FFmpeg 检查后，按管理员隔离保留 `MEDIA_UPLOAD_DAYS` 天，并返回 `uploadId`。保存草稿后通过 `POST /api/dramas/:id/cover/from-staging` 和该 ID 将封面关联到草稿；`DELETE /api/drama-cover-staging/:uploadId` 可取消未关联的临时封面。`GET /api/dramas/:id/cover` 读取已保存的草稿封面；`PUT /api/dramas/:id/cover` 可直接上传或更换封面；`POST /api/dramas/:id/cover/from-frame` 接受当前剧集媒体的 `mediaId` 和候选或手动截帧 `name`，需显式调用才更新短剧封面。关联写入只修改待发布草稿；旧的已关联封面资源暂不自动清理；所有接口均需管理员会话，写操作还需有效 Origin。


## 上下架 API

`GET /api/publication/dramas/:id?version=draft|live` 返回所选版本的剧目与逐集检查、提醒和内容指纹；`POST /api/publication/dramas/:id/publish` 通过 `scope: drama|episodes` 分别上架整剧及其就绪分集，或只上架所选分集，提交时重新校验内容和状态。历史审核记录只读保留，不再提供送审或审核写接口。`POST /api/visibility/dramas/offline` 只下架整剧，`POST /api/visibility/dramas/:id/episodes/offline` 只下架所选分集，彼此不自动切换对方状态。`GET /api/visibility/dramas/:id/history` 读取状态变更记录。写操作需要登录并校验 Origin。

版本、状态规则及尚未接入的观众端边界见 [本地上下架](../../docs/local-publication.md)。
