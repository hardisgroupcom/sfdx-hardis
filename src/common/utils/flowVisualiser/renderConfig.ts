/**
 * renderConfig.js
 */
export const NODE_CONFIG = {
	'actionCalls': {
		background: "#344568",
		color: "white",
		label: "Action",
		icon: "<&pulse>",
		mermaidIcon: {
			"apex": ">_",
			"emailAlert" : "✉",
			"emailSimple": "✉",
			"submit": "⚡"

		},
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'assignments': {
		background: "#F97924",
		color: "white",
		label: "Assignment",
		icon: "<&menu>",
		mermaidIcon: "⚌" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'collectionProcessors': {
		background: "#DD7A00",
		color: "white",
		label: {
			"FilterCollectionProcessor": "Collection Filter",
			"SortCollectionProcessor": "Collection Sort",
		},
		icon: "<&pulse>",
		mermaidIcon: {
			"FilterCollectionProcessor": "⑂",
			"SortCollectionProcessor" : "⇅",

		},
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'customErrors': {
		background: "#032D60",
		color: "white",
		label: "Custom Error",
		icon: "<&pencil>",
		mermaidIcon: "🚫" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'decisions': {
		background: "#DD7A00",
		color: "white",
		label: "Decision",
		icon: "<&fork>",
		mermaidIcon: "⇋" ,
		mermaidClose: "}}",
		mermaidOpen: "{{"
	},
	'loops': {
		background: "#E07D1C",
		label: "Loop",
		mermaidIcon: "↻",
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'recordCreates': {
		background: "#F9548A",
		color: "white",
		label: "Create Records",
		icon: "<&medical-cross>",
		mermaidIcon: "+" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'recordDeletes': {
		background: "#F9548A",
		color: "white",
		label: "Delete Records",
		icon: "<&medical-cross>",
		mermaidIcon: "-" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'recordLookups': {
		background: "#F9548A",
		color: "white",
		label: "Get Records",
		icon: "<&medical-cross>",
		mermaidIcon: "🔍" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'recordUpdates': {
		background: "#F9548A",
		color: "white",
		label: "Update Records",
		icon: "<&pencil>",
		mermaidIcon: "📝" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'screens': {
		background: "#1B96FF",
		color: "white",
		label: "Screen",
		icon: "<&pencil>",
		mermaidIcon: "💻" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
	'subflows': {
		background: "#032D60",
		color: "white",
		label: "Subflow",
		icon: "<&pencil>",
		mermaidIcon: "⎘" ,
		mermaidClose: ")",
		mermaidOpen: "("
	},
};