import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SqliteAuthCredentialStore } from "@oh-my-pi/pi-ai";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent/sdk";
import { getAgentDbPath } from "@oh-my-pi/pi-utils";
import { getProfileRootDir } from "@oh-my-pi/pi-utils/dirs";

const PROVIDER = "unit-profile-creds";
const ENV_KEYS = ["OMP_AUTH_BROKER_URL", "OMP_AUTH_BROKER_TOKEN", "OMP_PROFILE", "PI_CONFIG_DIR"] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

async function seedApiKey(dbPath: string, apiKey: string): Promise<void> {
	const store = await SqliteAuthCredentialStore.open(dbPath);
	try {
		store.saveApiKey(PROVIDER, apiKey);
	} finally {
		store.close();
	}
}

describe("profile credential storage", () => {
	let configRoot = "";
	let defaultAgentDir = "";
	let workAgentDir = "";

	beforeEach(async () => {
		for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
		for (const key of ENV_KEYS) delete process.env[key];
		process.env.PI_CONFIG_DIR = `.omp-profile-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`;
		configRoot = path.join(os.homedir(), process.env.PI_CONFIG_DIR);
		defaultAgentDir = path.join(configRoot, "agent");
		workAgentDir = path.join(getProfileRootDir("work"), "agent");
		await fs.mkdir(defaultAgentDir, { recursive: true, mode: 0o700 });
		await fs.mkdir(workAgentDir, { recursive: true, mode: 0o700 });
	});

	afterEach(async () => {
		for (const key of ENV_KEYS) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
		await fs.rm(configRoot, { recursive: true, force: true });
	});

	it("discovers credentials from the selected profile database", async () => {
		await seedApiKey(getAgentDbPath(defaultAgentDir), "default-profile-key");
		await seedApiKey(getAgentDbPath(workAgentDir), "work-profile-key");

		const defaultStorage = await discoverAuthStorage(defaultAgentDir);
		try {
			expect(await defaultStorage.getApiKey(PROVIDER)).toBe("default-profile-key");
		} finally {
			defaultStorage.close();
		}

		const workStorage = await discoverAuthStorage(workAgentDir);
		try {
			expect(await workStorage.getApiKey(PROVIDER)).toBe("work-profile-key");
		} finally {
			workStorage.close();
		}
	});
});
