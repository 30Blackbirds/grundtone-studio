var e = {
	primary: "#0059b3",
	primaryLight: "#3381cc",
	primaryDark: "#003a7a",
	onPrimary: "#ffffff",
	secondary: "#e9ecef",
	secondaryLight: "#f8f9fa",
	secondaryDark: "#dee2e6",
	success: "#198754",
	successLight: "#d1e7dd",
	successDark: "#146c43",
	warning: "#ffc107",
	warningLight: "#fff3cd",
	warningDark: "#cc9a06",
	error: "#dc3545",
	errorLight: "#f8d7da",
	errorDark: "#b02a37",
	info: "#0dcaf0",
	infoLight: "#cff4fc",
	infoDark: "#0aa2c0",
	background: "#ffffff",
	backgroundAlt: "#fafafa",
	surface: "#f8f9fa",
	surfaceAlt: "#f0f1f2",
	surfaceRaised: "#ffffff",
	surfaceOverlay: "rgba(255,255,255,0.95)",
	modalBackdrop: "rgba(0,0,0,0.5)",
	text: "#212529",
	textSecondary: "#6c757d",
	textTertiary: "#adb5bd",
	textInverse: "#ffffff",
	textPlaceholder: "#a3a3a3",
	textDisabled: "#d4d4d4",
	borderLight: "#dee2e6",
	borderMedium: "#ced4da",
	borderStrong: "#adb5bd",
	borderInverse: "rgba(255,255,255,0.2)",
	focus: "#0059b3",
	focusRing: "rgba(0,89,179,0.25)",
	neutral: "#6c757d"
}, t = {
	primary: "#4dabf7",
	primaryLight: "#74c0fc",
	primaryDark: "#339af0",
	onPrimary: "#121212",
	secondary: "#343a40",
	secondaryLight: "#495057",
	secondaryDark: "#2b3035",
	success: "#51cf66",
	successLight: "#1a3d20",
	successDark: "#40c057",
	warning: "#ffd43b",
	warningLight: "#3d3a1a",
	warningDark: "#fab005",
	error: "#ff6b6b",
	errorLight: "#3d1a1c",
	errorDark: "#fa5252",
	info: "#4dabf7",
	infoLight: "#1a2e3d",
	infoDark: "#339af0",
	background: "#121212",
	backgroundAlt: "#1a1a1a",
	surface: "#1e1e1e",
	surfaceAlt: "#252525",
	surfaceRaised: "#2a2a2a",
	surfaceOverlay: "rgba(30,30,30,0.95)",
	modalBackdrop: "rgba(0,0,0,0.7)",
	text: "#ffffff",
	textSecondary: "#b0b0b0",
	textTertiary: "#808080",
	textInverse: "#121212",
	textPlaceholder: "#666666",
	textDisabled: "#4a4a4a",
	borderLight: "#404040",
	borderMedium: "#505050",
	borderStrong: "#606060",
	borderInverse: "rgba(0,0,0,0.3)",
	focus: "#4dabf7",
	focusRing: "rgba(77,171,247,0.25)",
	neutral: "#9e9e9e"
}, n = {
	xs: "0.25rem",
	sm: "0.5rem",
	md: "1rem",
	lg: "1.5rem",
	xl: "2rem",
	"2xl": "3rem",
	"3xl": "4rem",
	"4xl": "6rem"
}, r = {
	fontFamily: {
		base: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
		heading: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
		mono: "'IBM Plex Mono', 'Courier New', monospace"
	},
	fontSize: {
		xs: "0.75rem",
		sm: "0.875rem",
		base: "1rem",
		lg: "1.125rem",
		xl: "1.25rem",
		"2xl": "1.5rem",
		"3xl": "1.875rem",
		"4xl": "2.25rem",
		"5xl": "3rem"
	},
	fontWeight: {
		thin: 100,
		light: 300,
		normal: 400,
		medium: 500,
		semibold: 600,
		bold: 700,
		extrabold: 800
	},
	lineHeight: {
		none: 1,
		tight: 1.25,
		snug: 1.375,
		normal: 1.5,
		relaxed: 1.625,
		loose: 2
	}
}, i = {
	xs: [{
		x: 0,
		y: 1,
		blur: 2,
		spread: 0,
		color: "#000000",
		opacity: .05
	}],
	sm: [{
		x: 0,
		y: 1,
		blur: 3,
		spread: 0,
		color: "#000000",
		opacity: .1
	}, {
		x: 0,
		y: 1,
		blur: 2,
		spread: 0,
		color: "#000000",
		opacity: .06
	}],
	md: [{
		x: 0,
		y: 4,
		blur: 6,
		spread: -1,
		color: "#000000",
		opacity: .1
	}, {
		x: 0,
		y: 2,
		blur: 4,
		spread: -1,
		color: "#000000",
		opacity: .06
	}],
	lg: [{
		x: 0,
		y: 10,
		blur: 15,
		spread: -3,
		color: "#000000",
		opacity: .1
	}, {
		x: 0,
		y: 4,
		blur: 6,
		spread: -2,
		color: "#000000",
		opacity: .05
	}],
	xl: [{
		x: 0,
		y: 20,
		blur: 25,
		spread: -5,
		color: "#000000",
		opacity: .1
	}, {
		x: 0,
		y: 10,
		blur: 10,
		spread: -5,
		color: "#000000",
		opacity: .04
	}],
	"2xl": [{
		x: 0,
		y: 25,
		blur: 50,
		spread: -12,
		color: "#000000",
		opacity: .25
	}],
	inner: [{
		x: 0,
		y: 2,
		blur: 4,
		spread: 0,
		color: "#000000",
		opacity: .06,
		inset: !0
	}]
};
function a(e) {
	let t = e.replace("#", ""), n = t.length === 3 ? t[0] + t[0] + t[1] + t[1] + t[2] + t[2] : t;
	return {
		r: parseInt(n.slice(0, 2), 16),
		g: parseInt(n.slice(2, 4), 16),
		b: parseInt(n.slice(4, 6), 16)
	};
}
function o(e) {
	return e.map((e) => {
		let t = e.inset ? "inset " : "", n = (e) => e === 0 ? "0" : `${e}px`, { r, g: i, b: o } = a(e.color);
		return `${t}${n(e.x)} ${n(e.y)} ${n(e.blur)} ${n(e.spread)} rgba(${r}, ${i}, ${o}, ${e.opacity})`;
	}).join(", ");
}
var s = {
	...Object.fromEntries(Object.entries(i).map(([e, t]) => [e, o(t)])),
	none: "none"
}, c = {
	none: "0",
	xs: "0.125rem",
	sm: "0.25rem",
	md: "0.375rem",
	lg: "0.5rem",
	xl: "0.75rem",
	"2xl": "1rem",
	"3xl": "1.5rem",
	full: "9999px"
}, l = {
	duration: {
		fast: "150ms",
		base: "300ms",
		slow: "500ms"
	},
	timing: {
		ease: "cubic-bezier(0.4, 0, 0.2, 1)",
		easeIn: "cubic-bezier(0.4, 0, 1, 1)",
		easeOut: "cubic-bezier(0, 0, 0.2, 1)",
		easeInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
		linear: "linear"
	}
}, u = {
	dropdown: 1e3,
	sticky: 1020,
	fixed: 1030,
	modalBackdrop: 1040,
	modal: 1050,
	popover: 1060,
	tooltip: 1070,
	toast: 1080
}, d = [
	"colors",
	"typography",
	"radius",
	"transitions",
	"spacing"
];
function f(e) {
	return e ? d.some((t) => t in e) ? e : { colors: e } : {};
}
function p(e, t) {
	return t ? {
		fontFamily: {
			...e.fontFamily,
			...t.fontFamily
		},
		fontSize: {
			...e.fontSize,
			...t.fontSize
		},
		fontWeight: {
			...e.fontWeight,
			...t.fontWeight
		},
		lineHeight: {
			...e.lineHeight,
			...t.lineHeight
		}
	} : { ...e };
}
function m(e, t) {
	return t ? {
		duration: {
			...e.duration,
			...t.duration
		},
		timing: {
			...e.timing,
			...t.timing
		}
	} : { ...e };
}
function h(e, t, a) {
	return {
		mode: e,
		colors: {
			...t,
			...a.colors
		},
		spacing: {
			...n,
			...a.spacing
		},
		typography: p(r, a.typography),
		shadows: { ...s },
		shadowDefinitions: { ...i },
		radius: {
			...c,
			...a.radius
		},
		transitions: m(l, a.transitions),
		zIndex: { ...u }
	};
}
function g(n) {
	return {
		light: h("light", e, f(n.light)),
		dark: h("dark", t, f(n.dark))
	};
}
h("light", e, {});
//#endregion
//#region src/applyThemeToDOM.ts
function _(e) {
	return e.replace(/[A-Z]/g, (e) => `-${e.toLowerCase()}`);
}
function v(e) {
	return e.map((e) => `${e.inset ? "inset " : ""}${e.x}px ${e.y}px ${e.blur}px ${e.spread}px ${e.color}`).join(", ");
}
function y(e, t) {
	if (typeof document > "u") return;
	let n = t ?? document.documentElement;
	n.style.setProperty("color-scheme", e.mode === "dark" ? "dark" : "light");
	for (let [t, r] of Object.entries(e.colors)) n.style.setProperty(`--color-${_(t)}`, r);
	for (let [t, r] of Object.entries(e.spacing)) n.style.setProperty(`--space-${t}`, r);
	for (let [t, r] of Object.entries(e.typography.fontFamily)) n.style.setProperty(`--font-family-${t}`, r);
	for (let [t, r] of Object.entries(e.typography.fontSize)) n.style.setProperty(`--font-size-${t}`, r);
	for (let [t, r] of Object.entries(e.typography.fontWeight)) n.style.setProperty(`--font-weight-${t}`, String(r));
	for (let [t, r] of Object.entries(e.typography.lineHeight)) n.style.setProperty(`--line-height-${t}`, String(r));
	for (let [t, r] of Object.entries(e.radius)) n.style.setProperty(`--radius-${t}`, r);
	for (let [t, r] of Object.entries(e.shadowDefinitions)) n.style.setProperty(`--shadow-${t}`, v(r));
	n.style.setProperty("--shadow-none", "none");
	for (let [t, r] of Object.entries(e.zIndex)) n.style.setProperty(`--z-${_(t)}`, String(r));
	for (let [t, r] of Object.entries(e.transitions.duration)) n.style.setProperty(`--duration-${t}`, r);
	for (let [t, r] of Object.entries(e.transitions.timing)) n.style.setProperty(`--${_(t)}`, r);
}
//#endregion
//#region src/index.ts
var b = "https://cdn.grundtone.com", x = "0.0.1";
function S() {
	return typeof window > "u" ? "light" : window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
async function C(e) {
	if (!e.apiKey) throw Error("apiKey is required");
	let t = `${(e.cdnBase ?? b).replace(/\/$/, "")}/k/${encodeURIComponent(e.apiKey)}/tokens.json`, n = await fetch(t, {
		headers: { Accept: "application/json" },
		cache: "default"
	});
	if (!n.ok) throw Error(`Failed to load tokens: ${n.status} ${n.statusText}`);
	let r = await n.json(), { dark: i, ...a } = r, o = g({
		light: a,
		dark: i?.colors && Object.keys(i.colors).length > 0 ? {
			...a,
			colors: {
				...a.colors,
				...i.colors
			}
		} : a
	}), s = e.mode ?? "light", c = s === "auto" ? S() : s;
	return y(c === "dark" ? o.dark : o.light, e.target), e.onLoad?.(r), {
		tokens: r,
		mode: c
	};
}
var w = { install(e, t) {
	C(t).catch((e) => {
		(t.onError ?? console.warn.bind(console, "[grundtone/saas-client]"))(e);
	});
} };
if (typeof document < "u") {
	let e = document.currentScript, t = e?.dataset.apiKey;
	t && C({
		apiKey: t,
		cdnBase: e?.dataset.cdnBase,
		mode: e?.dataset.mode ?? "light"
	}).catch((e) => {
		console.warn("[grundtone/saas-client] auto-init failed", e);
	});
}
//#endregion
export { x as VERSION, w as grundtone, C as loadByApiKey };

//# sourceMappingURL=index.mjs.map