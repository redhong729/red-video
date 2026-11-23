# 本地批量上传与媒体处理

完成数据库初始化后，先执行 `corepack pnpm db:migrate` 和 `corepack pnpm api:build`。安装 FFmpeg 和 ffprobe 并确保两个命令均在 PATH 中，例如本机使用 Homebrew 的 FFmpeg 9.0.2_1。分别在三个终端运行：

```sh
corepack pnpm api:start
corepack pnpm media:worker
corepack pnpm admin:dev
```

管理页面和 API 的启动及登录说明分别见 [后台管理页面](../backend/admin/README.md) 和 [API](../backend/api/README.md)。处理进程是独立进程，页面关闭后仍可处理已上传文件；它未运行时，已传完的任务会保持排队，启动后继续。上传进度区会区分传输中断、媒体处理失败和排队状态，并在存在排队任务时显示处理进程在线情况；传输中断可选择原文件续传，媒体处理失败可从失败阶段重试。当前处理进程一次处理一个文件，使用数据库锁避免多个进程重复处理，进程意外退出后重启可恢复未完成任务。

从短剧的剧集管理进入“批量上传”，选择文件并核对集号；已有剧集必须明确确认替换。上传页保留当前短剧的进度、续传、重试与取消操作；独立“媒体任务”菜单和跨剧页面已移除。站内切页时上传继续；刷新或关闭页面后，需要从剧集管理返回上传页，重新选择内容完全相同的原文件，系统校验文件指纹后续传缺失分片。文件检测、转码、候选封面及付费试看准备完成后，不会自动上架。剧集列表展示可复制的剧集 ID 与当前媒体 ID，可预览已处理视频，并从该行“选择封面”选择候选画面或按时间截帧；封面需明确确认保存。更改相关付费试看配置后，剧集列表会提示重新生成。

默认接收 MP4，每批最多 50 个文件，每个不超过 1 GiB；默认分片 5 MiB，未完成上传可在创建后 7 天内续传。可在 `backend/api/.env` 中设置 `MEDIA_MAX_FILES`、`MEDIA_MAX_BYTES`、`MEDIA_CHUNK_BYTES`、`MEDIA_UPLOAD_DAYS` 和 `MEDIA_STORAGE_DIR`，参见 `.env.example`；修改后重启 API 和处理进程。设置上限并不代表已验证相应负载。输入经 ffprobe 检测，输出 H.264、可选 AAC，保留横竖比例、最高 1080p 且不放大。损坏或不支持的输入可能处理失败；网络和临时处理错误最多额外自动重试两次，可从失败阶段手动重试。取消运行中任务时需等待处理进程确认停止。

草稿和已发布剧目的待发布素材均可处理；重新上传成功前保留原来选中的素材，取消或失败不移除它。已发布版本仍引用原素材，确认重新上架后才切换；观众端播放尚未实现。后台预览需要管理员会话，不能视作公开播放接口。

分集媒体文件位于项目根目录的 `storage/media`；短剧封面位于 `storage/drama-covers`，均不提交仓库。源文件、分片、处理结果和封面目前不会自动清理，续传到期也不会触发删除；需要预留磁盘空间，清理和资源生命周期策略在正式部署前另行设计，避免误删仍被引用的资源。

本地集成测试需要已启动 API 和媒体处理进程，在 `backend/api` 的环境中提供数据库地址，例如：

```sh
TEST_MEDIA=1 TEST_API_URL=http://127.0.0.1:4000 corepack pnpm --filter @red-video/api test
```

进程崩溃恢复测试需先停止常驻媒体处理进程，单独运行 `TEST_WORKER_RECOVERY=1 TEST_API_URL=http://127.0.0.1:4000 corepack pnpm --filter @red-video/api exec node --test test/media-recovery.test.mjs`，结束后重新启动处理进程。测试会创建并清理临时数据和媒体文件。
