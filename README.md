// dsh-preset-hotswap — 会话头部模式热切换（标准/PTC/创造），已开始的会话也可切。
// host 半边经 /dsh-preset-hotswap 暴露名单与切换；client 半边渲染 header 下拉。
// 安装：desktop profile 依赖 link: + cordis.patch.yml insert {id: preset-hotswap}，完全重启应用。
// 回滚：删 patch insert 行 + package.json 依赖，重启即可。
