# 技术版本基线

版本：v0.2 规划稿  
核对日期：2026-11-18（Asia/Shanghai）  
状态：数据库和 API 阶段已安装 Prisma、NestJS 及编译依赖并更新锁文件，PostgreSQL、迁移及 API 构建已验证；后台页面依赖已安装并构建；观众端 Next.js/next-intl 依赖已安装，首页生产构建已通过。

## 1. 版本选择原则

本文件是项目版本规划的统一依据，技术职责见 [技术方案](technical-plan.md)。以下数字是建议精确版本，不是“始终取最新版”的指令，也不代表本机已经安装。

- 运行时使用 Node 24 LTS，继续沿用上一轮选定的主版本。
- 使用正式版本，不将 alpha、beta、rc 或 canary 作为首期基线；即使注册表的 `latest` 指向候选版，也按明确版本安装。
- 选择满足组合依赖声明的版本。TypeScript、ESLint、框架配套包一起核对，不单独追随最新主版本。
- 直接依赖在初始化时使用精确版本；间接依赖由届时生成的 `pnpm-lock.yaml` 锁定。
- 此次核对的是版本存在、Node 要求与主要 peerDependencies，不替代实际安装、数据库迁移、构建和手机验收。

## 2. 运行时与工程工具

| 技术或包 | 规划版本 | 使用范围与依据 |
| --- | --- | --- |
| Node.js | **24.22.3** | 全项目；保留 24 LTS，使用已发布补丁，见 [官方发行目录](https://nodejs.org/dist/latest-v24.x/) |
| pnpm | **10.34.8** | 保留 10 系列，选择已发布的修复版本；项目无需以 12 系列为前提，见 [官方发布](https://github.com/pnpm/pnpm/releases/tag/v10.34.8) |
| TypeScript | **6.0.3** | 各应用统一；兼顾 NestJS 12 工具链和 typescript-eslint 支持范围，见 [发布元数据](https://registry.npmjs.org/typescript/6.0.3) |
| `@types/node` | **24.19.2** | 对齐 Node 24 主版本，类型包不要求与运行时补丁号相同，见 [发布元数据](https://registry.npmjs.org/@types%2Fnode/24.19.2) |

数据库实施时本机 Node 为 24.22.3，系统 pnpm 为 12.21.0；项目通过 Corepack 使用锁定的 pnpm 10.34.8。npm 与 Homebrew 属于环境辅助工具：现有记录为 npm 11.6.2、Homebrew 6.0.15，不额外作为工程依赖锁定；工程安装统一用 pnpm。

## 3. 观众前端

| 技术或包 | 规划版本 | 配套规则与来源 |
| --- | --- | --- |
| `next` | **16.4.6** | App Router，见 [发布元数据](https://registry.npmjs.org/next/16.4.6) |
| `react`、`react-dom` | **19.3.1** | 两个应用统一，两包保持相同精确版本，见 [React](https://registry.npmjs.org/react/19.3.1)、[React DOM](https://registry.npmjs.org/react-dom/19.3.1) |
| `@types/react`、`@types/react-dom` | **19.3.0** | 与 React 19 对齐，见 [React 类型](https://registry.npmjs.org/@types%2Freact/19.3.0)、[React DOM 类型](https://registry.npmjs.org/@types%2Freact-dom/19.3.0) |
| `tailwindcss`、`@tailwindcss/postcss` | **4.3.5** | Tailwind 与其 PostCSS 插件同版，见 [Tailwind](https://registry.npmjs.org/tailwindcss/4.3.5)、[插件](https://registry.npmjs.org/@tailwindcss%2Fpostcss/4.3.5) |
| `postcss` | **8.5.33** | 满足所选 Tailwind 插件的 `^8.5.25` 要求，见 [发布元数据](https://registry.npmjs.org/postcss/8.5.33) |
| `next-intl` | **4.15.1** | 支持所选 Next 16 与 React 19，见 [发布元数据](https://registry.npmjs.org/next-intl/4.15.1) |

主屏幕入口采用 Next 16.4.6 提供的 manifest 文件约定和浏览器标准能力，首期不额外选装 PWA 插件。Manifest、Service Worker 与原生 `video` 不单独填写 npm 包版本；其兼容性通过实际目标浏览器验收。

## 4. 后台管理界面

| 技术或包 | 规划版本 | 配套规则与来源 |
| --- | --- | --- |
| React 与类型包 | **沿用第 3 节** | 与观众端保持一致，不维护另一套 React 主版本 |
| `vite` | **8.3.8** | 支持选定 Node 24，见 [发布元数据](https://registry.npmjs.org/vite/8.3.8) |
| `@vitejs/plugin-react` | **6.3.0** | 声明支持 Vite `^8.0.0`，见 [发布元数据](https://registry.npmjs.org/@vitejs%2Fplugin-react/6.3.0) |
| `antd` | **6.7.1** | 声明 React、React DOM `>=18`，见 [发布元数据](https://registry.npmjs.org/antd/6.7.1) |
| `react-i18next` | **18.0.2** | 后台中英文业务文案，见 [发布元数据](https://registry.npmjs.org/react-i18next/18.0.2) |
| `i18next` | **27.1.5** | 满足 react-i18next 的 `>=27.0.1` 要求，见 [发布元数据](https://registry.npmjs.org/i18next/27.1.5) |

Ant Design locale 来自 antd 6.7.1，无需单独安装语言包。Vite React 插件列出的 React Compiler、Babel 与 Oxc 扩展为可选 peer，首期不因它们出现在元数据中就全部安装。

## 5. 服务端与数据层

| 技术或包 | 规划版本 | 配套规则与来源 |
| --- | --- | --- |
| `@nestjs/core`、`@nestjs/common`、`@nestjs/platform-express` | **12.5.1** | 三个运行时包同版，见 [Core](https://registry.npmjs.org/@nestjs%2Fcore/12.5.1)、[Common](https://registry.npmjs.org/@nestjs%2Fcommon/12.5.1)、[Express 适配器](https://registry.npmjs.org/@nestjs%2Fplatform-express/12.5.1) |
| `@nestjs/cli`、`@nestjs/schematics` | **12.0.13** | CLI 与生成工具同版；CLI 版本不要求等于框架补丁号，见 [CLI](https://registry.npmjs.org/@nestjs%2Fcli/12.0.13)、[Schematics](https://registry.npmjs.org/@nestjs%2Fschematics/12.0.13) |
| `rxjs` | **7.8.2** | 满足 Nest 的 `^7.1.0` 要求，见 [发布元数据](https://registry.npmjs.org/rxjs/7.8.2) |
| `reflect-metadata` | **0.2.2** | 满足 Nest 元数据依赖，见 [发布元数据](https://registry.npmjs.org/reflect-metadata/0.2.2) |
| PostgreSQL | **18.7** | 当前受支持的 18 系列版本，见 [官方版本表](https://www.postgresql.org/support/versioning/) |
| `prisma`、`@prisma/client`、`@prisma/adapter-pg` | **7.10.1** | CLI、客户端、PostgreSQL 适配器同版，见 [Prisma](https://registry.npmjs.org/prisma/7.10.1)、[Client](https://registry.npmjs.org/@prisma%2Fclient/7.10.1)、[Adapter](https://registry.npmjs.org/@prisma%2Fadapter-pg/7.10.1) |
| `pg` | **8.23.1** | 满足适配器的 `^8.16.3` 要求，见 [发布元数据](https://registry.npmjs.org/pg/8.23.1) |

Express **5.3.0** 和 Multer **2.5.0** 由上述 Nest Express 适配器声明为依赖，交给锁文件记录；应用确需直接导入时，再将同版加入直接依赖，避免额外安装另一套。

后端按所选 Nest 版本配置 TypeScript 编译与装饰器元数据，Prisma 7 按其对应版本文档接入。禁止把 Prisma 8 的客户端、迁移或配置示例直接混入 Prisma 7 工程。

## 6. 媒体与质量工具

| 技术或包 | 规划版本 | 范围与来源 |
| --- | --- | --- |
| FFmpeg | **9.0.2（本机 Homebrew revision 1）** | 已用于本地命令行媒体处理，见 [Homebrew 公式](https://formulae.brew.sh/formula/ffmpeg) |
| ffprobe | **与 FFmpeg 9.0.2 同一发行包** | 随 FFmpeg 安装，不选装同名 npm 包 |
| `eslint` | **9.39.5** | 使用 flat config，见 [发布元数据](https://registry.npmjs.org/eslint/9.39.5) |
| `eslint-config-next` | **16.4.6** | 与 Next 精确版本保持一致，见 [发布元数据](https://registry.npmjs.org/eslint-config-next/16.4.6) |
| `typescript-eslint` | **8.73.0** | 支持 ESLint 9、TypeScript `>=4.8.4 <6.1.0`，见 [发布元数据](https://registry.npmjs.org/typescript-eslint/8.73.0) |
| `@nestjs/testing` | **12.5.1** | 与 Nest 运行时包同版，见 [发布元数据](https://registry.npmjs.org/@nestjs%2Ftesting/12.5.1) |
| Node 内置测试运行器 | **跟随 Node 24.22.3** | 后端关键业务测试使用预编译后的 TypeScript 输出，不直接跳过装饰器编译 |
| `@playwright/test` | **1.65.1** | 浏览器验收，见 [发布元数据](https://registry.npmjs.org/@playwright%2Ftest/1.65.1) |

Playwright 的浏览器程序与测试包配套安装，不使用任意旧缓存作为固定测试环境。桌面浏览器模拟不能替代 iPhone、安卓的真实主屏幕入口验收。

## 7. 关键兼容结论

1. **Node 选择 24.22.3。** Nest Schematics 12.0.13 声明 Node `^22.22.3 || ^24.15.0 || >=26.0.0`；本机现有 24.12.0 不满足其 Node 24 分支。其他主要组件要求也应在初始化时由包管理器复核。
2. **TypeScript 选择 6.0.3。** Nest Schematics 需要 `>=6.0.0`，typescript-eslint 8.73.0 支持 `<6.1.0`，6.0.3 位于两者交集中。注册表当前 TypeScript 最新为 7.0.2，本项目不直接采用。
3. **ESLint 保留 9.39.5。** 尽管 eslint-config-next 的顶层声明是 `>=9`，其 React 与无障碍检查插件仍限制到 ESLint 9；不能仅查看顶层范围就升级到 10。
4. **Prisma 固定 7.10.1 三件套。** 核对时 `prisma/latest` 返回 8.0.0-rc.34，而客户端和适配器的 latest 为 7.10.1。必须显式指定同一正式版本，避免直接按标签安装造成主版本混用。
5. **配套包共同升级。** React 与 React DOM 同版；Next 与 eslint-config-next 同版；Nest 的运行时与 testing 同版；Prisma 三件套同版；Tailwind 与其 PostCSS 插件同版。
6. **pnpm 采用 10.34.8，无需升级到 12。** [官方兼容表](https://pnpm.io/10.x/installation#compatibility)列明 pnpm 10 支持 Node 24，并且已有 [workspace 能力](https://pnpm.io/10.x/workspaces)。10.11.0 可满足基本使用，但处于已公布安装相关问题的受影响范围，见 [Git 依赖脚本处理公告](https://github.com/pnpm/pnpm/security/advisories/GHSA-379q-355j-w6rj)和[依赖别名路径处理公告](https://github.com/pnpm/pnpm/security/advisories/GHSA-hwx4-2j3j-g496)。建议首次安装项目依赖前更新到本基线；本轮只调整规划，不升级本机工具。10.34.8 是此次选定且已核对发布的版本，不声称它始终是最新的 10 系列版本。

对应元数据已通过 npm 官方注册表只读查询核对；[typescript-eslint 官方支持范围](https://typescript-eslint.io/users/dependency-versions/)与上述编译检查约束一致。这里只能说明版本声明可组合，未声称完整依赖树或实际应用已构建通过。

## 8. 初始化与升级规则

工程配置按以下规则维护；数据库阶段已创建根配置和统一锁文件：

- `.nvmrc`：记录 `24.22.3`。
- 根 `package.json`：`packageManager` 使用 `pnpm@10.34.8`，`engines.node` 建议为 `>=24.22.3 <25`。
- 直接依赖写精确版本，配置 `save-exact=true`；不使用 `latest`、`*` 或自动浮动的主版本范围。
- 提交统一的 `pnpm-lock.yaml`，后续安装使用 frozen lockfile，避免各子应用自行维护不同锁文件。
- 发生 peer 冲突时调整版本或配置，并更新本文；不以强制安装代替兼容处理。
- 版本变化先核对声明和发布说明，再运行类型检查、相关测试、构建和必要的数据库迁移验证。

数据库阶段额外使用 `dotenv` 17.2.3 加载本地连接配置。

Homebrew 的 `postgresql@18` 仅固定主版本，`ffmpeg` 公式也会随时间变化。安装后需实际检查 PostgreSQL、FFmpeg 与 ffprobe 的版本并记录；若版本与表格不同，应更新基线并验证，不能声称这些命令永久固定到 18.7 与 9.0.2。需要可重复的系统工具镜像时，在部署阶段另外固定制品。

## 9. 尚不指定版本的后期组件

Redis、队列、专用搜索、对象存储、CDN、HLS 播放库、支付 SDK 与广告 SDK 尚未进入实施范围，不提前固定版本。确定具体需求与服务商后，再补版本和兼容记录。
