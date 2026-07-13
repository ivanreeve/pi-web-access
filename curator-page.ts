import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeInlineJSON(data: unknown): string {
	return JSON.stringify(data)
		.replace(/</g, "\\u003c")
		.replace(/>/g, "\\u003e")
		.replace(/&/g, "\\u0026")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

export function generateCuratorPage(
	queries: string[],
	sessionToken: string,
	timeout: number,
	availableProviders: { openai: boolean; brave: boolean; parallel: boolean; tavily: boolean; perplexity: boolean; exa: boolean; gemini: boolean },
	defaultProvider: string,
	searchProvider: string,
	summaryModels: Array<{ value: string; label: string }>,
	defaultSummaryModel: string | null,
): string {
	const inlineData = safeInlineJSON({ 
		queries, 
		sessionToken, 
		timeout, 
		defaultProvider, 
		searchProvider, 
		summaryModels, 
		defaultSummaryModel, 
		availableProviders 
	});

	const assetsDir = path.join(__dirname, "curator-ui", "dist", "assets");
	let cssContent = "";
	let jsContent = "";

	try {
		const files = fs.readdirSync(assetsDir);
		const cssFile = files.find(f => f.endsWith(".css"));
		const jsFile = files.find(f => f.endsWith(".js"));

		if (cssFile) {
			cssContent = fs.readFileSync(path.join(assetsDir, cssFile), "utf-8");
		}
		if (jsFile) {
			jsContent = fs.readFileSync(path.join(assetsDir, jsFile), "utf-8");
		}
	} catch (err) {
		console.error("Failed to read prebuilt curator assets from curator-ui/dist/assets:", err);
	}

	// Escape close script tags in JS bundle to prevent premature browser parsing
	const safeJsContent = jsContent.replace(/<\/script>/gi, "<\\/script>");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Curate Search Results</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Noto+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet">
<style>
${cssContent}
</style>
<script>
window.DATA = ${inlineData};
</script>
</head>
<body>
<div id="root"></div>
<script type="module">
${safeJsContent}
</script>
</body>
</html>`;
}
