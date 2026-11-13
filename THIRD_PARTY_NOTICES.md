# 第三方组件与字体

拾页在 Windows 和 Android 构建中使用了以下开源组件。各组件版权归其作者所有，遵循各自许可证。

## 字体

| 字体 | 用途 | 许可证 |
| --- | --- | --- |
| Noto Serif SC | 正文宋体 | SIL Open Font License 1.1 |
| Noto Sans SC | 界面无衬线字体 | SIL Open Font License 1.1 |
| LXGW WenKai（霞鹜文楷） | 楷体正文选项 | SIL Open Font License 1.1 |

字体通过 `@fontsource` 打包进应用，不经过网络加载。OFL 许可证允许随应用分发和嵌入，要求保留版权与许可证声明，且不得单独售卖字体。

- Noto Fonts: https://github.com/notofonts/noto-cjk
- LXGW WenKai: https://github.com/lxgw/LxgwWenKai

## 运行时与库

| 组件 | 许可证 |
| --- | --- |
| Electron | MIT |
| React / React DOM | MIT |
| Zustand | MIT |
| Zod | MIT |
| Lucide | ISC |
| better-sqlite3 | MIT |
| sql.js | MIT |
| Capacitor（core / android / app / filesystem / keyboard / share / splash-screen / status-bar） | MIT |
| OkHttp | Apache License 2.0 |
| Vite / Vitest | MIT |

完整许可证文本随各依赖发布在 `node_modules` 中，也可在对应项目的代码仓库查看。
