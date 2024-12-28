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
	}
};
