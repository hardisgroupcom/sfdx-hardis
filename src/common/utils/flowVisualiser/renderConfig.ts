interface MermaidNodeRenderConfig {
	background: string;
	color: string;
	stroke?: string;
	strokeWidth?: string;
	label?: string | Record<string, string>;
	icon?: string;
	mermaidIcon?: string | Record<string, string>;
	mermaidClose?: string;
	mermaidOpen?: string;
}

interface MermaidDiffRenderConfig {
	background: string;
	color: string;
	lineColor: string;
	strokeWidth: string;
}

export const NODE_CONFIG = {
	'actionCalls': {
		background: "#D4E4FC", // Light blue
		color: "black",
		label: "",
		icon: "<&pulse>",
		mermaidIcon: {
			"apex": "⚙️",
			"emailAlert": "📧",
			"emailSimple": "📧",
			"submit": "⚡"
		},
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'assignments': {
		background: "#FBEED7", // Light beige
		color: "black",
		label: "",
		icon: "<&menu>",
		mermaidIcon: "🟰",
		mermaidClose: "/]",
		mermaidOpen: "[\\"
	},
	'collectionProcessors': {
		background: "#F0E3FA", // Light lavender
		color: "black",
		label: {
			"FilterCollectionProcessor": "Collection Filter",
			"SortCollectionProcessor": "Collection Sort",
		},
		icon: "<&pulse>",
		mermaidIcon: {
			"FilterCollectionProcessor": "🔽",
			"SortCollectionProcessor": "🔃",
		},
		mermaidClose: "}}",
		mermaidOpen: "{{"
	},
	'customErrors': {
		background: "#FFE9E9", // Pale blush
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "🚫",
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'decisions': {
		background: "#FDEAF6", // Light pink
		color: "black",
		label: "",
		icon: "<&fork>",
		mermaidIcon: "🔀",
		mermaidClose: "}",
		mermaidOpen: "{"
	},
	'loops': {
		background: "#FDEAF6", // Light pink (harmonized with decisions)
		label: "",
		color: "black",
		mermaidIcon: "🔁",
		mermaidClose: "}}",
		mermaidOpen: "{{"
	},
	'recordCreates': {
		background: "#FFF8C9", // Light periwinkle (harmonized with recordCreates and recordDeletes)
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "➕",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordDeletes': {
		background: "#FFF8C9", // Light periwinkle (harmonized with recordCreates and recordDeletes)
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "🗑️",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordLookups': {
		background: "#EDEAFF", // Pale yellow
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "🔍",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordRollbacks': {
		background: "#FFF8C9", // Light periwinkle (harmonized with recordCreates and recordDeletes)
		color: "black",
		label: "",
		icon: "<&undo>",
		mermaidIcon: "↩️",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordUpdates': {
		background: "#FFF8C9", // Light periwinkle (harmonized with recordCreates and recordDeletes)
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "🛠️",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'screens': {
		background: "#DFF6FF", // Pale sky blue
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "💻",
		mermaidClose: "])",
		mermaidOpen: "(["
	},
	'subflows': {
		background: "#D4E4FC", // Light blue (harmonized with actionCalls)
		color: "black",
		label: "Subflow",
		icon: "<&pencil>",
		mermaidIcon: "🔗",
		mermaidClose: "]]",
		mermaidOpen: "[["
	},
	"startClass": {
		background: "#D9F2E6", // Light turquoise (between green and blue)
		color: "black"
	},
	"endClass": {
		background: "#F9BABA", // Slightly shinier pale re
		color: "black"
	},
	'transforms': {
		background: "#FDEAF6", // Light pink
		color: "black",
		label: "",
		mermaidIcon: "♻️",
		mermaidClose: "}}",
		mermaidOpen: "{{"
	},
} satisfies Record<string, MermaidNodeRenderConfig>;

export const MERMAID_DIFF_CONFIG = {
	added: {
		background: "green",
		color: "white",
		lineColor: "#00ff00",
		strokeWidth: "4px",
	},
	removed: {
		background: "red",
		color: "white",
		lineColor: "#ff0000",
		strokeWidth: "4px",
	},
	changed: {
		background: "orange",
		color: "white",
		lineColor: "orange",
		strokeWidth: "4px",
	},
} satisfies Record<string, MermaidDiffRenderConfig>;

export type MermaidNodeKey = keyof typeof NODE_CONFIG;
export type MermaidDiffKey = keyof typeof MERMAID_DIFF_CONFIG;
export type MermaidNodeConfig = MermaidNodeRenderConfig;

export interface MermaidNodeStyleOverride {
	background?: string;
	color?: string;
	stroke?: string;
	strokeWidth?: string;
	mermaidOpen?: string;
	mermaidClose?: string;
}

export interface MermaidDiffStyleOverride {
	background?: string;
	color?: string;
	lineColor?: string;
	strokeWidth?: string;
}

export interface ResolvedMermaidTheme {
	nodeConfig: typeof NODE_CONFIG;
	diffConfig: typeof MERMAID_DIFF_CONFIG;
}

const MERMAID_THEME_NODE_ALIAS_MAP = {
	action: "actionCalls",
	actionCalls: "actionCalls",
	assignment: "assignments",
	assignments: "assignments",
	collectionProcessor: "collectionProcessors",
	collectionProcessors: "collectionProcessors",
	customError: "customErrors",
	customErrors: "customErrors",
	decision: "decisions",
	decisions: "decisions",
	loop: "loops",
	loops: "loops",
	recordCreate: "recordCreates",
	recordCreates: "recordCreates",
	recordDelete: "recordDeletes",
	recordDeletes: "recordDeletes",
	recordLookup: "recordLookups",
	recordLookups: "recordLookups",
	recordRollback: "recordRollbacks",
	recordRollbacks: "recordRollbacks",
	rollback: "recordRollbacks",
	rollbacks: "recordRollbacks",
	recordUpdate: "recordUpdates",
	recordUpdates: "recordUpdates",
	screen: "screens",
	screens: "screens",
	start: "startClass",
	startClass: "startClass",
	subflow: "subflows",
	subflows: "subflows",
	end: "endClass",
	endClass: "endClass",
	transform: "transforms",
	transforms: "transforms",
} as const satisfies Record<string, MermaidNodeKey>;

const MERMAID_THEME_DIFF_ALIAS_MAP = {
	added: "added",
	removed: "removed",
	changed: "changed",
} as const satisfies Record<string, MermaidDiffKey>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeColorValue(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmedValue = value.trim();
	if (trimmedValue === "") {
		return undefined;
	}
	if (/^#?[0-9a-fA-F]{3}$/.test(trimmedValue) || /^#?[0-9a-fA-F]{6}$/.test(trimmedValue)) {
		return trimmedValue.startsWith("#") ? trimmedValue : `#${trimmedValue}`;
	}
	return trimmedValue;
}

function normalizeStrokeWidthValue(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmedValue = value.trim();
	return trimmedValue === "" ? undefined : trimmedValue;
}

function normalizeStringValue(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmedValue = value.trim();
	return trimmedValue === "" ? undefined : trimmedValue;
}

function applyNodeStyleOverride(
	nodeConfig: typeof NODE_CONFIG,
	nodeKey: MermaidNodeKey,
	override: unknown,
) {
	if (!isRecord(override)) {
		return;
	}
	const nodeEntry = nodeConfig[nodeKey] as MermaidNodeConfig;
	const background = normalizeColorValue(override.background);
	if (background) {
		nodeEntry.background = background;
	}
	const color = normalizeColorValue(override.color);
	if (color) {
		nodeEntry.color = color;
	}
	const stroke = normalizeColorValue(override.stroke);
	if (stroke) {
		nodeEntry.stroke = stroke;
	}
	const strokeWidth = normalizeStrokeWidthValue(override.strokeWidth);
	if (strokeWidth) {
		nodeEntry.strokeWidth = strokeWidth;
	}
	const mermaidOpen = normalizeStringValue(override.mermaidOpen);
	if (mermaidOpen) {
		nodeEntry.mermaidOpen = mermaidOpen;
	}
	const mermaidClose = normalizeStringValue(override.mermaidClose);
	if (mermaidClose) {
		nodeEntry.mermaidClose = mermaidClose;
	}
}

function applyDiffStyleOverride(
	diffConfig: typeof MERMAID_DIFF_CONFIG,
	diffKey: MermaidDiffKey,
	override: unknown,
) {
	if (!isRecord(override)) {
		return;
	}
	const background = normalizeColorValue(override.background);
	const lineColor = normalizeColorValue(override.lineColor);
	if (background) {
		diffConfig[diffKey].background = background;
		if (!lineColor) {
			diffConfig[diffKey].lineColor = background;
		}
	}
	const color = normalizeColorValue(override.color);
	if (color) {
		diffConfig[diffKey].color = color;
	}
	if (lineColor) {
		diffConfig[diffKey].lineColor = lineColor;
	}
	const strokeWidth = normalizeStrokeWidthValue(override.strokeWidth);
	if (strokeWidth) {
		diffConfig[diffKey].strokeWidth = strokeWidth;
	}
}

function applyAliasOverride(
	nodeConfig: typeof NODE_CONFIG,
	diffConfig: typeof MERMAID_DIFF_CONFIG,
	key: string,
	value: unknown,
) {
	const normalizedValue = normalizeColorValue(value);
	if (!normalizedValue) {
		return;
	}
	if (key.endsWith("TextColor")) {
		const alias = key.slice(0, -"TextColor".length);
		const nodeAlias = MERMAID_THEME_NODE_ALIAS_MAP[alias as keyof typeof MERMAID_THEME_NODE_ALIAS_MAP];
		if (nodeAlias) {
			nodeConfig[nodeAlias].color = normalizedValue;
			return;
		}
		const diffAlias = MERMAID_THEME_DIFF_ALIAS_MAP[alias as keyof typeof MERMAID_THEME_DIFF_ALIAS_MAP];
		if (diffAlias) {
			diffConfig[diffAlias].color = normalizedValue;
		}
		return;
	}
	if (key.endsWith("LinkColor")) {
		const alias = key.slice(0, -"LinkColor".length);
		const diffAlias = MERMAID_THEME_DIFF_ALIAS_MAP[alias as keyof typeof MERMAID_THEME_DIFF_ALIAS_MAP];
		if (diffAlias) {
			diffConfig[diffAlias].lineColor = normalizedValue;
		}
		return;
	}
	if (!key.endsWith("Color")) {
		return;
	}
	const alias = key.slice(0, -"Color".length);
	const nodeAlias = MERMAID_THEME_NODE_ALIAS_MAP[alias as keyof typeof MERMAID_THEME_NODE_ALIAS_MAP];
	if (nodeAlias) {
		nodeConfig[nodeAlias].background = normalizedValue;
		return;
	}
	const diffAlias = MERMAID_THEME_DIFF_ALIAS_MAP[alias as keyof typeof MERMAID_THEME_DIFF_ALIAS_MAP];
	if (diffAlias) {
		diffConfig[diffAlias].background = normalizedValue;
		diffConfig[diffAlias].lineColor = normalizedValue;
	}
}

export function resolveMermaidTheme(mermaidTheme: unknown): ResolvedMermaidTheme {
	const nodeConfig = structuredClone(NODE_CONFIG);
	const diffConfig = structuredClone(MERMAID_DIFF_CONFIG);
	if (!isRecord(mermaidTheme)) {
		return { nodeConfig, diffConfig };
	}
	for (const [key, value] of Object.entries(mermaidTheme)) {
		if (key in NODE_CONFIG) {
			applyNodeStyleOverride(nodeConfig, key as MermaidNodeKey, value);
			continue;
		}
		if (key in MERMAID_DIFF_CONFIG) {
			applyDiffStyleOverride(diffConfig, key as MermaidDiffKey, value);
			continue;
		}
		applyAliasOverride(nodeConfig, diffConfig, key, value);
	}
	return { nodeConfig, diffConfig };
}
