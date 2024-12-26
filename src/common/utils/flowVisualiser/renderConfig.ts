/**
 * renderConfig.js
 */
export const NODE_CONFIG = {
	'actionCalls': {
		background: "#b6dafa",
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
		background: "#befadb",
		color: "black",
		label: "",
		icon: "<&menu>",
		mermaidIcon: "🟰",
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'collectionProcessors': {
		background: "#DD7A00",
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
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'customErrors': {
		background: "#032D60",
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "🚫",
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'decisions': {
		background: "#f7e1e4",
		color: "black",
		label: "",
		icon: "<&fork>",
		mermaidIcon: "🔀",
		mermaidClose: "}",
		mermaidOpen: "{"
	},
	'loops': {
		background: "#e0f5c6",
		label: "",
		mermaidIcon: "🔁",
		mermaidClose: "/]",
		mermaidOpen: "[/"
	},
	'recordCreates': {
		background: "#d5def5",
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "➕",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordDeletes': {
		background: "#d5def5",
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "🗑️",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordLookups': {
		background: "#f5facd",
		color: "black",
		label: "",
		icon: "<&medical-cross>",
		mermaidIcon: "🔍",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'recordUpdates': {
		background: "#d5def5",
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "🛠️",
		mermaidClose: ")]",
		mermaidOpen: "[("
	},
	'screens': {
		background: "#cdf1fa",
		color: "black",
		label: "",
		icon: "<&pencil>",
		mermaidIcon: "💻",
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'subflows': {
		background: "#032D60",
		color: "black",
		label: "Subflow",
		icon: "<&pencil>",
		mermaidIcon: "🔗",
		mermaidClose: "]]",
		mermaidOpen: "[["
	},
	"startClass": {
		background: "#bbfacb",
		color: "black"
	},
	"endClass": {
		background: "#faacbb",
		color: "black"
	}
};