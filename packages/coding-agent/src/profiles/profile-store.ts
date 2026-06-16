/**
 * Dir-based profile path helpers.
 *
 * Profiles map to directories:
 * - default: <config-root>/agent
 * - named:  <config-root>/profiles/<name>/agent
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent, logger } from "@oh-my-pi/pi-utils";
import { normalizeProfileName } from "@oh-my-pi/pi-utils/dirs";

function getConfigRootFromAgentDir(agentDir: string): string {
	const resolved = path.resolve(agentDir);
	if (path.basename(resolved) !== "agent") {
		return path.dirname(resolved);
	}
	const profileRoot = path.dirname(resolved);
	const profilesDir = path.dirname(profileRoot);
	if (path.basename(profilesDir) === "profiles") {
		return path.dirname(profilesDir);
	}
	return profileRoot;
}

export function getProfileDir(agentDir: string, profileName: string): string {
	const configRoot = getConfigRootFromAgentDir(agentDir);
	const normalized = normalizeProfileName(profileName);
	return normalized ? path.join(configRoot, "profiles", normalized, "agent") : path.join(configRoot, "agent");
}

export async function listProfileDirs(agentDir: string): Promise<string[]> {
	const profilesDir = path.join(getConfigRootFromAgentDir(agentDir), "profiles");
	const names: string[] = [];
	try {
		const entries = await fs.readdir(profilesDir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const normalized = normalizeProfileName(entry.name);
			if (!normalized) continue;
			names.push(normalized);
		}
	} catch (err) {
		if (!isEnoent(err))
			logger.warn("Profile store: failed to read profiles dir", { path: profilesDir, error: String(err) });
	}
	return ["default", ...names.sort()];
}
