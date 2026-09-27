// dsh-preset-hotswap — host half（本地插件）
//
// 功能：让「已开始」的会话也能切换 agent preset（对话模式：标准 / PTC / 创造）。
//
// 原理（对照 0.1.7-rc.2 源码 dsh-agent-preset-registry/lib/index.js）：
//   官方 agentPresets.select() 在 turnBoundary 显示会话已开始时抛
//   agent-preset/locked（"This session has already started"）——锁在策略层。
//   registry.recompose(agentCtx, id)（= retain + bind，bind 自带 rebind 路径，
//   旧 generation 按引用数保留不销毁）+ session.append("agent-preset/selected")
//   正是 select() 锁检查之后的全部动作。本插件把这两步经 /dsh-preset-hotswap
//   路由暴露给 client 半边，并把「拒切」收紧到「只在 turn 进行中拒切」。
//
//   切换后：session 投影 agentPreset 前移（官方头部徽标自动更新）；
//   tools/change 由 recompose 发出（下一轮请求即用新 preset 的工具目录）；
//   重启恢复按投影终值挂载。代价：该会话前缀 KV cache 失效一次（工具目录
//   变了的本质代价，不可避免）。
//
// 依赖的服务：agents（活体 agent 注册表）、agentPresets（registry 实例）、
// sessionProjections（turnBoundary 守卫）、webServer（自定义路由）。
export const name = "dsh-preset-hotswap";
export const inject = ["agents", "agentPresets", "webServer", "sessionProjections"];

const log = (...a) => console.log("[dsh-preset-hotswap]", ...a);

function fail(code, message) {
	const e = new Error(message);
	e.code = code;
	return e;
}

export function apply(ctx) {
	const switches = new Map(); // sessionId -> Promise，串行化同一会话的连续切换

	async function switchPreset(sessionId, agentPreset) {
		if (typeof sessionId !== "string" || sessionId === "") throw fail("bad-request", "sessionId required");
		if (typeof agentPreset !== "string" || agentPreset === "") throw fail("bad-request", "agentPreset required");
		const presets = ctx.agentPresets;
		if (presets === undefined) throw fail("unavailable", "agentPresets registry absent");

		const prev = switches.get(sessionId) ?? Promise.resolve();
		const turn = prev.then(async () => {
			const agent = ctx.agents?.get?.(sessionId);
			if (agent === undefined) throw fail("session/not-live", `session "${sessionId}" has no live agent`);

			// 官方 select() 连「已开始」都拒；这里只拒「turn 正在进行」——
			// 轮次间隙（lastTurn > 0 且无 open turn）允许热切换。
			const boundary = ctx.sessionProjections?.stateOf?.(agent.session, "turnBoundary");
			if (
				boundary !== undefined && boundary !== null &&
				boundary.openTurnStartSeq !== null && boundary.openTurnStartSeq !== undefined
			) {
				throw fail("turn/open", "A turn is running; switch after it finishes");
			}

			// 先 resolve 拿干净的 404（含 available 列表），再走 rebind。
			try {
				await presets.resolve(agentPreset);
			} catch (error) {
				const avail = error?.details?.available;
				throw fail(
					"agent-preset/not-found",
					`Unknown agent preset: ${agentPreset}${Array.isArray(avail) ? ` (available: ${avail.join(", ")})` : ""}`,
				);
			}

			const preset = await presets.recompose(agent.ctx, agentPreset); // retain + bind(rebind) + tools/change
			agent.session.append("agent-preset/selected", { agentPreset: preset.id }); // 投影前移，日志诚实
			return { agentPreset: preset.id };
		});
		switches.set(sessionId, turn.catch(() => {}));
		return turn;
	}

	const reply = (res, status, obj) => {
		try {
			res.writeHead(status, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify(obj));
		} catch {}
	};

	const readBody = (req) =>
		new Promise((resolve, reject) => {
			let data = "";
			req.on("data", (c) => {
				data += c;
				if (data.length > 1e6) {
					reject(new Error("body too large"));
					req.destroy();
				}
			});
			req.on("end", () => resolve(data));
			req.on("error", reject);
		});

	const statusOf = (code) =>
		code === "session/not-live" || code === "agent-preset/not-found"
			? 404
			: code === "turn/open"
				? 409
				: 400;

	ctx.inject(["webServer"], (wctx) => {
		ctx.effect(
			() =>
				wctx.webServer.register({
					kind: "prefix",
					path: "/dsh-preset-hotswap",
					handler: async (req, res) => {
						const url = new URL(req.url ?? "/", "http://localhost");
						const path = url.pathname.replace(/\/$/, "");
						try {
							if (req.method === "POST" && path === "/dsh-preset-hotswap/switch") {
								let body = {};
								try {
									body = JSON.parse((await readBody(req)) || "{}");
								} catch (error) {
									reply(res, 400, { ok: false, error: `bad json: ${String(error?.message ?? error)}` });
									return;
								}
								try {
									reply(res, 200, { ok: true, ...(await switchPreset(body.sessionId, body.agentPreset)) });
								} catch (error) {
									reply(res, statusOf(error?.code), { ok: false, error: String(error?.message ?? error) });
								}
								return;
							}
							if (req.method === "GET" && (path === "/dsh-preset-hotswap" || path === "/dsh-preset-hotswap/list")) {
								const presets = ctx.agentPresets;
								const roster = presets !== undefined ? await presets.remoteExportList() : { presets: [] };
								reply(res, 200, { ok: true, ...roster, at: new Date().toISOString() });
								return;
							}
							reply(res, 404, { ok: false, error: "unknown route" });
						} catch (error) {
							reply(res, 500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				}),
			"dsh-preset-hotswap: switch route",
		);
	});

	log("host half mounted; POST /dsh-preset-hotswap/switch {sessionId, agentPreset}");
}
