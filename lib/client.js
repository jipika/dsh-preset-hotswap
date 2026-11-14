// dsh-preset-hotswap — browser half（本地插件）
//
// v2：不再自渲染按钮，**把点击行为挂到原生「xx模式」徽标上**（避免出现两个模式
// 显示）。原生 AgentPresetLabel 是纯静态 span（无 onClick，只有 title 提示），
// 且只在 preset!==undefined 时渲染。做法：
//   1. 本插件在 `conversation.session.header.actions`（order -9，紧跟官方 -10）
//      只渲染一个 display:none 的锚点；
//   2. MutationObserver 盯住锚点的父容器（slot 出口是 display:contents，条目
//      根元素互为兄弟），取锚点前面的兄弟元素即原生徽标，挂 click + 光标样式，
//      并打 data-preset-hotswap 标记（CSS ::after 补一个小 ▾ 提示可点）；
//   3. 点开的是 portal 到 body 的模式下拉，名单走 host 半边路由，切换 POST
//      /dsh-preset-hotswap/switch（已开始的会话也能切，turn 进行中会被 host 拒）。
//
// 注意：改本文件后必须完全退出并重开 DSH Desktop（client bundle 在 host 启动时
// 读进内存，刷新页面无效）。
if (!window.__dshPresetHotswapRegistered) {
	window.__dshPresetHotswapRegistered = true;
	window.__ModuleLoader__.load({
		id: "dsh-preset-hotswap",
		factory: (require) => {
			var module = { exports: {} };
			var exports = module.exports;
			Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

			const React = require("react");
			const ReactDOM = require("react-dom");
			const h = React.createElement;

			const BASE = "/dsh-preset-hotswap";
			const BUILTIN_LABEL = {
				standard: "标准模式",
				ptc: "PTC 模式",
				cordis: "创造模式",
				minimal: "极简模式",
				writing: "写作模式",
				video: "视频模式",
			};
			const labelOf = (p) => (p && (BUILTIN_LABEL[p.id] ?? p.name)) || (p && p.id) || "?";

			/* ───────────────────────── 样式（一次性注入） ───────────────────────── */
			//
			// 菜单外观照官方 ui-primitives/Menu + MenuSurface 的度量与 token 复刻：
			//   表面 = --dsw-menu-surface-fill（深色 rgba(48,49,54,.64)）+ 40px 毛玻璃
			//         + --dsw-elevation-prominent（0.5px 发丝描边 + 两层柔光）
			//   卡片 = padding 4 / 圆角 --dsw-radius-lg
			//   行   = min-height 34 / padding 6 8 / gap 6 / 13px·20px / radius-md
			//   hover = --dsw-alias-interactive-bg-hover
			//  选中 = 尾部 14px 对勾（官方 check-outline 路径），不是文字「✓ 当前」
			// 之前用 Canvas/CanvasText 系统色 + rgba 兜底，深色下就是一块纯黑、
			// 描边阴影都对不上，和官方菜单摆在一起像另一个软件。
			const STYLE_ID = "dsh-preset-hotswap-style";
			const MENU_CSS = [
				/* 原生徽标：可点提示 */
				'[data-preset-hotswap="1"]{cursor:pointer!important;transition:opacity .15s}',
				'[data-preset-hotswap="1"]:hover{opacity:.75}',
				'[data-preset-hotswap="1"]::after{content:"";display:inline-block;width:0;height:0;margin-left:4px;vertical-align:middle;border-left:3px solid transparent;border-right:3px solid transparent;border-top:3.5px solid currentColor;opacity:.45}',

				/* 菜单表面 */
				'.dph-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;',
				'min-width:168px;max-width:320px;max-height:min(320px,calc(100vh - 24px));overflow-y:auto;padding:4px;',
				'border:0;border-radius:var(--dsw-radius-lg);',
				/* 材质就在根元素上：再叠一层不透明底会把 blur 结果盖住，界面就变成实心色。 */
				'background:var(--dsw-menu-surface-fill,rgba(48,49,54,.64));',
				'backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));',
				'-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));',
				'box-shadow:var(--dsw-elevation-prominent);',
				'--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);',
				'--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);',
				'--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);',
				'color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;',
				'animation:dph-menu-in .12s ease-out}',
				/* 深色主题下菜单面的描边抬一档，和宿主 [data-menu-material] 的规则同源 */
				'body[data-ds-dark-theme] .dph-menu{--dsw-elevation-stroke-color:var(--dsw-alias-border-l3)}',

				/* 行 */
				'.dph-item{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;padding:6px 8px;border:0;',
				'border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);',
				'font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;-webkit-user-select:none;user-select:none}',
				'@media (hover:hover){.dph-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}}',
				'.dph-item:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}',
				'.dph-item:disabled{opacity:.4;cursor:not-allowed}',
				'.dph-item-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
				'.dph-check{flex:none;display:inline-flex;width:14px;height:14px;color:var(--dsw-alias-label-primary)}',
				'.dph-hint{padding:6px 8px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
				'.dph-err{margin:4px;padding:6px 8px;border-radius:var(--dsw-radius-sm);font-size:11px;line-height:16px;',
				'color:var(--dsw-alias-state-error-primary);',
				'background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);white-space:pre-wrap;overflow-wrap:anywhere}',

				'@keyframes dph-menu-in{from{opacity:0}to{opacity:1}}',
				'@media (prefers-reduced-motion:reduce){.dph-menu{animation:none}}',

				/* 非视频模式收窄 dsh-comfyui 的可见面：它未安装时这两个选择器零匹配，不会有任何副作用 */
				/* 只在宽屏收窄：手机上（H5）没地方放这个入口，别跟着模式一起藏掉。 */
				'@media (min-width:1024px){html[data-dph-preset]:not([data-dph-preset="video"]) .dsc-trigger,',
				'html[data-dph-preset]:not([data-dph-preset="video"]) .dsc-panel{display:none!important}}',
			].join("");
			function injectStyle() {
				/* 复用同一个 <style>，内容变了就地改写：热刷新时旧规则不会赖着不走。 */
				let st = document.getElementById(STYLE_ID);
				if (st === null) {
					st = document.createElement("style");
					st.id = STYLE_ID;
					document.head.appendChild(st);
				}
				if (st.textContent !== MENU_CSS) st.textContent = MENU_CSS;
			}

			/* 官方 check-outline 的 14px 图形，颜色吃 currentColor。 */
			const CHECK_ICON = React.createElement(
				"span",
				{ className: "dph-check", "aria-hidden": "true" },
				React.createElement(
					"svg",
					{ viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", strokeWidth: 1.1 },
					React.createElement("path", {
						d: "M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4",
						stroke: "currentColor",
					}),
				),
			);

			/* ───────────────────────── 名单与切换 ───────────────────────── */
			let rosterCache = { at: 0, presets: null, error: null };
			async function loadRoster() {
				if (rosterCache.presets !== null && Date.now() - rosterCache.at < 5000) return rosterCache;
				try {
					const res = await fetch(`${BASE}/list`, { headers: { Accept: "application/json" } });
					const data = await res.json().catch(() => ({}));
					if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
					rosterCache = { at: Date.now(), presets: data.presets ?? [], error: null };
				} catch (error) {
					rosterCache = { at: Date.now(), presets: null, error: String(error?.message ?? error) };
				}
				return rosterCache;
			}

			async function switchPreset(sessionId, agentPreset) {
				const res = await fetch(`${BASE}/switch`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId, agentPreset }),
				});
				const data = await res.json().catch(() => ({}));
				if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
				return data;
			}

			/* ───────────────────────── 组件：隐形锚点 + 菜单 ───────────────────────── */
			function HotswapAnchor(props) {
				const sessionId = props.sessionId ?? props.session?.id;
				const useProjection = props.useProjection;
				const current = typeof useProjection === "function" ? useProjection("agentPreset") : null;

				const [open, setOpen] = React.useState(false);
				const [presets, setPresets] = React.useState(null);
				const [rosterError, setRosterError] = React.useState(null);
				const [busy, setBusy] = React.useState(false);
				const [err, setErr] = React.useState(null);
				/* 菜单坐标：只记「上沿」和「距视口右边的距离」——菜单宽度随内容变，
				   右对齐就不用量宽度，也不会因为多了一条错误行就偏出屏幕。 */
				const [pos, setPos] = React.useState(null);
				const anchorRef = React.useRef(null);
				const menuRef = React.useRef(null);
				const badgeRef = React.useRef(null);

				injectStyle();

				/* 给原生徽标挂点击；React 重渲染换节点时由 Observer 重新挂 */
				const attach = React.useCallback(() => {
					const anchor = anchorRef.current;
					const parent = anchor?.parentNode;
					if (!anchor || !parent) return;
					const kids = Array.from(parent.children);
					const idx = kids.indexOf(anchor);
					const badge = idx > 0 ? kids[idx - 1] : null;
					if (!badge || badge === badgeRef.current) return;
					if (badgeRef.current) {
						badgeRef.current.removeAttribute("data-preset-hotswap");
						if (badgeRef.current.__dphClick) badgeRef.current.removeEventListener("click", badgeRef.current.__dphClick);
					}
					const onClick = (e) => {
						e.preventDefault();
						e.stopPropagation();
						setErr(null);
						const rect = badge.getBoundingClientRect();
						/* 距徽标下沿 4px（官方 Menu 的 gap），右边缘与徽标对齐 */
						setPos({
							top: Math.round(rect.bottom + 4),
							right: Math.max(8, Math.round(window.innerWidth - rect.right)),
						});
						setOpen((o) => {
							if (o) return false;
							loadRoster().then((r) => {
								setPresets(r.presets);
								setRosterError(r.error);
							});
							return true;
						});
					};
					badge.__dphClick = onClick;
					badge.addEventListener("click", onClick);
					badge.setAttribute("data-preset-hotswap", "1");
					badgeRef.current = badge;
				}, []);

				/* 把当前模式暴露到 <html>，供同页样式做作用域收窄（例：非视频模式隐藏 ComfyUI 的入口）。
				   全程不引用 dsh-comfyui 的任何代码：它没装时这个属性只是没人消费，零副作用。 */
				React.useEffect(() => {
					const el = document.documentElement;
					if (current === null || current === undefined || current === "") el.removeAttribute("data-dph-preset");
					else el.setAttribute("data-dph-preset", String(current));
					return () => { el.removeAttribute("data-dph-preset"); };
				}, [current]);

				React.useEffect(() => {
					attach();
					const parent = anchorRef.current?.parentNode;
					if (!parent) return;
					const obs = new MutationObserver(() => attach());
					obs.observe(parent, { childList: true });
					return () => obs.disconnect();
				}, [attach, current]);

				/* H5 聚合弹层（dsh-h5-adapter 的 ⋯）通过自定义事件唤起模式菜单。
				   窄屏下原生徽标被官方容器查询隐藏、rect 为 0，但菜单在 H5 会被
				   adapter 的 [role=menu] 规则强制贴底，pos 用默认值即可。 */
				React.useEffect(() => {
					const openFromSheet = () => {
						setErr(null);
						setPos({ top: 48, right: 16 });
						setOpen((o) => {
							if (o) return false;
							loadRoster().then((r) => { setPresets(r.presets); setRosterError(r.error); });
							return true;
						});
					};
					window.addEventListener("dsh-h5-open-preset", openFromSheet);
					return () => window.removeEventListener("dsh-h5-open-preset", openFromSheet);
				}, []);

				React.useEffect(() => {
					if (!open) return;
					const onDown = (e) => {
						if (badgeRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
						setOpen(false);
					};
					const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
					/* 菜单是 position:fixed，页面一滚就脱锚；抓住任何层级的滚动直接关掉。 */
					const onDetach = () => setOpen(false);
					document.addEventListener("pointerdown", onDown, true);
					document.addEventListener("keydown", onKey);
					window.addEventListener("scroll", onDetach, true);
					window.addEventListener("resize", onDetach);
					return () => {
						document.removeEventListener("pointerdown", onDown, true);
						document.removeEventListener("keydown", onKey);
						window.removeEventListener("scroll", onDetach, true);
						window.removeEventListener("resize", onDetach);
					};
				}, [open]);

				const doSwitch = React.useCallback(async (id) => {
					if (busy) return;
					setBusy(true);
					setErr(null);
					try {
						await switchPreset(sessionId, id);
						setOpen(false);
					} catch (error) {
						setErr(String(error?.message ?? error));
					} finally {
						setBusy(false);
					}
				}, [busy, sessionId]);

				/* 隐形锚点：唯一的可见 UI 是原生徽标上的 ▾（CSS ::after）与菜单 */
				const rows = presets ?? [];
				return h(
					"span",
					{ ref: anchorRef, "data-preset-hotswap-anchor": "1", style: { display: "none" } },
					open
						? ReactDOM.createPortal(
							h(
								"div",
								{
									ref: menuRef,
									className: "dph-menu",
									role: "menu",
									"aria-label": "切换模式",
									style: { top: pos?.top ?? 48, right: pos?.right ?? 16 },
									onClick: (e) => e.stopPropagation(),
								},
								rosterError !== null
									? h("div", { className: "dph-err" }, `名单获取失败：${rosterError}`)
									: presets === null
										? h("div", { className: "dph-hint" }, "载入中…")
										: rows.length === 0
											? h("div", { className: "dph-hint" }, "没有可用的 preset")
											: null,
								rows.map((p) =>
									h(
										"button",
										{
											key: p.id,
											type: "button",
											role: "menuitemradio",
											"aria-checked": p.id === current ? "true" : "false",
											title: p.broken ? `该 preset 加载失败：${p.broken}` : labelOf(p),
											className: "dph-item",
											disabled: busy || p.broken !== undefined,
											onClick: () => { if (!p.broken) doSwitch(p.id); },
										},
										h("span", { className: "dph-item-label" }, labelOf(p)),
										p.id === current ? CHECK_ICON : null,
									),
								),
								err !== null ? h("div", { className: "dph-err" }, err) : null,
							),
							document.body,
						)
						: null,
				);
			}

			/* ───────────────────────── 挂载 ───────────────────────── */
			function apply(ctx) {
				try {
					ctx.slots.inject("conversation.session.header.actions", () =>
						ctx.slots.register(
							{ name: "conversation.session.header.actions", id: "preset-hotswap", order: -9 },
							HotswapAnchor,
						));
					console.log("[dsh-preset-hotswap] v2 mounted (native-badge click attach)");
				} catch (error) {
					console.error("[dsh-preset-hotswap] slot inject failed", error);
				}
			}

			exports.name = "dsh-preset-hotswap";
			exports.inject = ["slots"];
			exports.apply = apply;
			return module.exports;
		},
	});
}
