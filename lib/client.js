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
			const STYLE_ID = "dsh-preset-hotswap-style";
			function injectStyle() {
				if (document.getElementById(STYLE_ID)) return;
				const st = document.createElement("style");
				st.id = STYLE_ID;
				st.textContent =
					'[data-preset-hotswap="1"]{cursor:pointer!important;transition:opacity .15s}' +
					'[data-preset-hotswap="1"]:hover{opacity:.75}' +
					'[data-preset-hotswap="1"]::after{content:" ▾";font-size:9px;opacity:.45}' +
					/* 非视频模式收窄 dsh-comfyui 的可见面：它未安装时这两个选择器零匹配，不会有任何副作用 */
					'html[data-dph-preset]:not([data-dph-preset="video"]) .dsc-trigger,' +
					'html[data-dph-preset]:not([data-dph-preset="video"]) .dsc-panel{display:none!important}';
				document.head.appendChild(st);
			}

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

			/* ───────────────────────── 样式常量（菜单） ───────────────────────── */
			const s = {
				menu: {
					position: "fixed", zIndex: 10000, minWidth: 176, maxHeight: 320, overflowY: "auto",
					background: "Canvas", color: "CanvasText",
					border: "1px solid rgba(127,127,127,0.28)", borderRadius: 10,
					boxShadow: "0 8px 28px rgba(0,0,0,0.18)", padding: 4, fontSize: 12,
				},
				item: {
					display: "flex", alignItems: "center", gap: 8, width: "100%",
					padding: "6px 9px", borderRadius: 7, border: "none",
					background: "transparent", color: "inherit",
					font: "inherit", fontSize: 12, textAlign: "left", cursor: "pointer",
				},
				itemHover: { background: "rgba(127,127,127,0.14)" },
				itemDisabled: { opacity: 0.45, cursor: "default" },
				check: { marginLeft: "auto", opacity: 0.9, fontSize: 11 },
				err: {
					margin: "4px 6px", padding: "6px 8px", borderRadius: 6, fontSize: 11,
					background: "rgba(220,80,80,0.12)", color: "inherit", whiteSpace: "pre-wrap",
				},
				hint: { padding: "6px 9px", opacity: 0.55, fontSize: 11 },
			};

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
				const [hoverItem, setHoverItem] = React.useState(-1);
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
						setPos({ top: rect.bottom + 6, left: Math.max(8, rect.right - 196) });
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

				React.useEffect(() => {
					if (!open) return;
					const onDown = (e) => {
						if (badgeRef.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
						setOpen(false);
					};
					const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
					document.addEventListener("pointerdown", onDown, true);
					document.addEventListener("keydown", onKey);
					return () => {
						document.removeEventListener("pointerdown", onDown, true);
						document.removeEventListener("keydown", onKey);
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
									style: { ...s.menu, top: pos?.top ?? 48, left: pos?.left ?? 8 },
									onClick: (e) => e.stopPropagation(),
								},
								rosterError !== null
									? h("div", { style: s.err }, `名单获取失败：${rosterError}`)
									: presets === null
										? h("div", { style: s.hint }, "载入中…")
										: rows.length === 0
											? h("div", { style: s.hint }, "没有可用的 preset")
											: null,
								rows.map((p, i) =>
									h(
										"button",
										{
											key: p.id,
											title: p.broken ? `该 preset 加载失败：${p.broken}` : labelOf(p),
											style: {
												...s.item,
												...(hoverItem === i ? s.itemHover : null),
												...((p.broken !== undefined || busy) ? s.itemDisabled : null),
											},
											onMouseEnter: () => setHoverItem(i),
											onMouseLeave: () => setHoverItem(-1),
											disabled: busy,
											onClick: () => { if (!p.broken) doSwitch(p.id); },
										},
										h("span", null, labelOf(p)),
										p.id === current ? h("span", { style: s.check }, "✓ 当前") : null,
									),
								),
								err !== null ? h("div", { style: s.err }, err) : null,
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
