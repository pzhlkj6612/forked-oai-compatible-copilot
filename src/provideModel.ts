import * as vscode from "vscode";
import { CancellationToken, LanguageModelChatInformation } from "vscode";

import type { HFApiMode, HFModelItem, HFModelsResponse } from "./types";
import { normalizeUserModels } from "./utils";
import { VersionManager } from "./versionManager";
import { fetchGeminiModels } from "./gemini/geminiApi";
import { fetchOllamaModels } from "./ollama/ollamaApi";

const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Get the list of available language models contributed by this provider
 * @param options Options which specify the calling context of this function
 * @param token A cancellation token which signals if the user cancelled the request or not
 * @returns A promise that resolves to the list of available language models
 */
export async function prepareLanguageModelChatInformation(
	_options: { silent: boolean },
	_token: CancellationToken
): Promise<LanguageModelChatInformation[]> {
	const config = vscode.workspace.getConfiguration();
	const userModels = normalizeUserModels(config.get<unknown>("oaicopilot.models", []));

	if (!userModels || userModels.length === 0) {
		return [];
	}

	// Return user-provided models directly
	const infos = userModels
		.filter((m) => !m.id.startsWith("__provider__"))
		.map((m) => {
			const contextLen = m?.context_length ?? DEFAULT_CONTEXT_LENGTH;
			const maxOutput = m?.max_completion_tokens ?? m?.max_tokens ?? DEFAULT_MAX_TOKENS;
			const maxInput = Math.max(1, contextLen - maxOutput);

			// 使用配置ID（如果存在）来生成唯一的模型ID
			const modelId = m.configId ? `${m.id}::${m.configId}` : m.id;
			const modelName =
				m.displayName || (m.configId ? `${m.id}::${m.configId} via ${m.owned_by}` : `${m.id} via ${m.owned_by}`);

			return {
				id: modelId,
				name: modelName,
				tooltip: m.configId
					? `OAI Compatible ${m.id} (config: ${m.configId}) via ${m.owned_by}`
					: `OAI Compatible via ${m.owned_by}`,
				family: m.family ?? "oai-compatible",
				version: "1.0.0",
				maxInputTokens: maxInput,
				maxOutputTokens: maxOutput,
				capabilities: {
					toolCalling: true,
					imageInput: m?.vision ?? false,
				},
			} satisfies LanguageModelChatInformation;
		});

	// console.debug("[OAI Compatible Model Provider] Loaded models:", infos);
	return infos;
}

/**
 * Fetch the list of models and supplementary metadata from Provider.
 */
export async function fetchModels(
	baseUrl: string,
	apiKey: string,
	apiMode?: HFApiMode | string,
	customHeaders?: Record<string, string>
): Promise<{ models: HFModelItem[] }> {
	const normalizedApiMode = apiMode ?? "openai";
	if (normalizedApiMode === "gemini") {
		const models = await fetchGeminiModels(baseUrl, apiKey, customHeaders);
		return { models };
	} else if (normalizedApiMode === "ollama") {
		const models = await fetchOllamaModels(baseUrl, apiKey, customHeaders);
		return { models };
	}

	const modelsList = (async () => {
		const baseHeaders: Record<string, string> = {
			Authorization: `Bearer ${apiKey}`,
			"User-Agent": VersionManager.getUserAgent(),
		};
		const headers = customHeaders ? { ...baseHeaders, ...customHeaders } : baseHeaders;
		const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
			method: "GET",
			headers,
		});
		if (!resp.ok) {
			let text = "";
			try {
				text = await resp.text();
			} catch (error) {
				console.error("[OAI Compatible Model Provider] Failed to read response text", error);
			}
			const err = new Error(
				`Failed to fetch OAI Compatible models: ${resp.status} ${resp.statusText}${text ? `\n${text}` : ""}`
			);
			console.error("[OAI Compatible Model Provider] Failed to fetch OAI Compatible models", err);
			throw err;
		}
		const parsed = (await resp.json()) as HFModelsResponse;
		return parsed.data ?? [];
	})();

	try {
		const models = await modelsList;
		return { models };
	} catch (err) {
		console.error("[OAI Compatible Model Provider] Failed to fetch OAI Compatible models", err);
		throw err;
	}
}

