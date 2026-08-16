// This loader-ready file is the canonical web client source distributed by
// the package; dsh loads it directly without a separate build step.
window.__ModuleLoader__.load({
	id: "@arslan-jh/deepseek-harness-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		const css = '.dsu-usage{box-sizing:border-box;width:100%;max-width:var(--dsh-chat-content-width);margin:0 auto;padding:2px calc(var(--dsh-composer-side-clearance) + 16px) 0;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
			'.dsu-usage b{color:var(--dsw-alias-label-secondary);font-weight:500;font-variant-numeric:tabular-nums}' +
			'.dsu-settings{border-bottom:1px solid var(--dsw-alias-border-l2);padding:16px 0;display:flex;flex-direction:column;gap:10px}' +
			'.dsu-settings-title{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}' +
			'.dsu-settings-desc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}' +
			'.dsu-settings-row{display:flex;align-items:center;gap:10px}' +
			'.dsu-settings-label{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px;flex:none;min-width:150px}' +
			'.dsu-settings-input{box-sizing:border-box;height:32px;flex:1;min-width:0;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);border-radius:6px;outline:none;padding:0 8px;font-size:13px;line-height:20px}' +
			'.dsu-settings-input:focus{border-color:var(--dsw-alias-state-business-primary)}' +
			'.dsu-settings-btn{height:32px;flex:none;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-radius:6px;padding:0 12px;font-size:13px;line-height:20px}' +
			'.dsu-settings-btn:hover{background:var(--dsw-alias-interactive-bg-active)}' +
			'.dsu-settings-status{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}';
		const tagId = "ds-usage/client.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "ds-usage";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		function fmtMoney(n, currency) {
			const sym = currency === "USD" ? "$" : "\u00a5";
			return sym + Number(n).toFixed(2);
		}

		function UsageCell() {
			const [data, setData] = React.useState(null);
			const [error, setError] = React.useState(null);
			React.useEffect(() => {
				let alive = true;
				const load = () => {
					fetch("/api/ds-usage", { cache: "no-store" }).then((response) => {
						if (!response.ok) throw new Error("HTTP " + response.status);
						return response.json();
					}).then((res) => {
						if (!alive) return;
						if (res === null || res === undefined || res.ok !== true) {
							setError(String(res !== null && res !== undefined && res.message ? res.message : "fetch failed"));
							return;
						}
						setData(res);
						setError(null);
					}, (reason) => {
						if (!alive) return;
						setError(String(reason !== null && typeof reason === "object" && reason.message ? reason.message : reason));
					});
				};
				load();
				const iv = window.setInterval(load, 180000);
				return () => {
					alive = false;
					window.clearInterval(iv);
				};
			}, []);

			if (data === null && error !== null) {
				return React.createElement("div", { className: "dsu-usage", title: error }, "\u6d88\u8d39 \u00b7 \u4f59\u989d\u52a0\u8f7d\u5931\u8d25");
			}
			if (data === null) return React.createElement("div", { className: "dsu-usage" }, "\u2026");
			const parts = [];
			if (data.todayCost !== null && data.todayCost !== undefined && data.todaySource !== null) {
				parts.push(React.createElement("span", {
					key: "today",
					title: data.todaySource === "estimate" ? "\u4f59\u989d\u5dee\u503c\u7d2f\u8ba1\uff1a\u5df2\u6309\u5b98\u65b9\u6570\u5b57\u6821\u51c6\u951a\u5b9a\uff0c\u968f\u6d88\u8d39\u5b9e\u65f6\u66f4\u65b0\uff08\u5728\u8bbe\u7f6e\u9875\u53ef\u91cd\u65b0\u6821\u51c6\uff09" : "\u6765\u81ea platform.deepseek.com \u9875\u9762\u5185\u90e8\u7528\u91cf\u63a5\u53e3\uff08\u975e\u516c\u5f00 API\uff09"
				}, "\u4eca\u65e5\u6d88\u8d39 ", React.createElement("b", null, (data.todaySource === "estimate" ? "\u2248" : "") + fmtMoney(data.todayCost, data.balance !== null ? data.balance.currency : "CNY"))));
			}
			if (data.balance !== null) {
				parts.push(React.createElement("span", {
					key: "bal",
					title: "\u603b\u4f59\u989d = \u5145\u503c " + fmtMoney(data.balance.topped, data.balance.currency) + " + \u8d60\u9001 " + fmtMoney(data.balance.granted, data.balance.currency)
				}, "\u603b\u4f59\u989d ", React.createElement("b", null, fmtMoney(data.balance.total, data.balance.currency))));
			}
			if (parts.length === 0) return null;
			const children = [];
			for (let i = 0; i < parts.length; i += 1) {
				if (i > 0) children.push(React.createElement("span", { key: "sep" + i, style: { margin: "0 10px", color: "var(--dsw-alias-separator-primary)" } }, "|"));
				children.push(parts[i]);
			}
			if (data.message) children.push(React.createElement("span", { key: "warning", title: data.message, style: { marginLeft: "8px" } }, "\u26a0"));
			return React.createElement("div", { className: "dsu-usage", title: data.message || undefined }, children);
		}

		function SettingsRow() {
			const [cost, setCost] = React.useState("");
			const [token, setToken] = React.useState("");
			const [status, setStatus] = React.useState(null);
			const post = (body) => fetch("/api/ds-usage-config", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body)
			}).then((response) => response.json());
			const onAnchor = () => {
				const n = Number(cost);
				if (!Number.isFinite(n) || n < 0) {
					setStatus("\u8bf7\u8f93\u5165\u6709\u6548\u91d1\u989d");
					return;
				}
				setStatus("\u4fdd\u5b58\u4e2d\u2026");
				post({ cost: Math.round(n * 100) / 100 }).then((res) => {
					if (res !== null && res !== undefined && res.ok === true) {
						setStatus("\u5df2\u6821\u51c6\uff1a\u4eca\u65e5\u6d88\u8d39 \u00a5" + Number(res.cost).toFixed(2) + "\uff08\u5f53\u524d\u4f59\u989d \u00a5" + Number(res.balance).toFixed(2) + "\uff09");
						setCost("");
					} else {
						setStatus(String(res !== null && res !== undefined && res.message ? res.message : "\u5931\u8d25"));
					}
				}, (reason) => setStatus(String(reason !== null && typeof reason === "object" && reason.message ? reason.message : reason)));
			};
			const onToken = () => {
				if (token.trim() === "") {
					setStatus("\u8bf7\u8f93\u5165 token");
					return;
				}
				setStatus("\u4fdd\u5b58\u4e2d\u2026");
				post({ token: token.trim() }).then((res) => {
					if (res !== null && res !== undefined && res.ok === true) {
						setStatus(res.tokenStored === true ? "token \u5df2\u4fdd\u5b58\uff0c\u5e73\u53f0\u9875\u9762\u6570\u636e\u5c06\u5728\u4e0b\u6b21\u5237\u65b0\u751f\u6548" : String(res.message || "\u5931\u8d25"));
						if (res.tokenStored === true) setToken("");
					} else {
						setStatus(String(res !== null && res !== undefined && res.message ? res.message : "\u5931\u8d25"));
					}
				}, (reason) => setStatus(String(reason !== null && typeof reason === "object" && reason.message ? reason.message : reason)));
			};
			const onClearToken = () => {
				setStatus("\u5220\u9664\u4e2d\u2026");
				post({ clearToken: true }).then((res) => {
					if (res !== null && res !== undefined && res.ok === true && res.tokenCleared === true) {
						setToken("");
						setStatus("\u5e73\u53f0 token \u5df2\u5220\u9664\uff0c\u540e\u7eed\u6539\u7528\u4f59\u989d\u5dee\u4f30\u7b97");
					} else {
						setStatus(String(res !== null && res !== undefined && res.message ? res.message : "\u5931\u8d25"));
					}
				}, (reason) => setStatus(String(reason !== null && typeof reason === "object" && reason.message ? reason.message : reason)));
			};
			return React.createElement("div", { className: "dsu-settings" },
				React.createElement("div", { className: "dsu-settings-title" }, "DeepSeek \u7528\u91cf\u663e\u793a"),
				React.createElement("div", { className: "dsu-settings-desc" }, "\u7edf\u8ba1\u884c\u4e0b\u65b9\u7684\u300c\u4eca\u65e5\u6d88\u8d39 \u00b7 \u603b\u4f59\u989d\u300d\u3002\u603b\u4f59\u989d\u81ea\u52a8\u83b7\u53d6\uff1b\u4eca\u65e5\u6d88\u8d39\u9ed8\u8ba4\u6309\u4f59\u989d\u5dee\u503c\u7d2f\u8ba1\uff0c\u8f93\u5165\u5e73\u53f0\u6570\u5b57\u53ef\u7cbe\u786e\u6821\u51c6\u3002\u53ef\u9009\u5e73\u53f0 token \u8c03\u7528\u7684\u662f\u5b98\u7f51\u9875\u9762\u5185\u90e8\u63a5\u53e3\uff0c\u5e76\u975e\u516c\u5f00 API\uff0c\u5931\u6548\u65f6\u4f1a\u81ea\u52a8\u56de\u9000\u5230\u4f30\u7b97\u3002"),
				React.createElement("div", { className: "dsu-settings-row" },
					React.createElement("span", { className: "dsu-settings-label" }, "\u4eca\u65e5\u6d88\u8d39\u6821\u51c6 (\u00a5)"),
					React.createElement("input", { className: "dsu-settings-input", value: cost, placeholder: "\u4f8b\u5982 9.25", onChange: (e) => setCost(e.target.value) }),
					React.createElement("button", { className: "dsu-settings-btn", onClick: onAnchor }, "\u4fdd\u5b58")
				),
				React.createElement("div", { className: "dsu-settings-row" },
					React.createElement("span", { className: "dsu-settings-label" }, "\u5e73\u53f0 token\uff08\u53ef\u9009\uff09"),
					React.createElement("input", { className: "dsu-settings-input", type: "password", value: token, placeholder: "platform.deepseek.com \u7684 userToken", onChange: (e) => setToken(e.target.value) }),
					React.createElement("button", { className: "dsu-settings-btn", onClick: onToken }, "\u4fdd\u5b58"),
					React.createElement("button", { className: "dsu-settings-btn", onClick: onClearToken }, "\u5220\u9664")
				),
				status !== null ? React.createElement("div", { className: "dsu-settings-status" }, status) : null
			);
		}

		function apply(ctx) {
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("conversation.composer.dock", () => slots.register(
				{ name: "conversation.composer.dock", id: "deepseek-harness-usage", order: 1 },
				() => React.createElement(UsageCell)
			));
			slots.inject("settings.general.item", () => slots.register(
				{ name: "settings.general.item", id: "deepseek-harness-usage", order: 30 },
				() => React.createElement(SettingsRow)
			));
		}

		exports.apply = apply;
		return module.exports;
	}
});
