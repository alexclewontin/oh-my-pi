import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getAgentDbPath, getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { getProfileRootDir, setProfile } from "@oh-my-pi/pi-utils/dirs";
import { YAML } from "bun";
import { resetSettingsForTest, Settings } from "../src/config/settings";
import { AgentStorage } from "../src/session/agent-storage";
import { resolveAuthBrokerConfig } from "../src/session/auth-broker-config";
import { createSubagentSettings } from "../src/task/executor";

let testRoot = "";
let testAgentDir = "";
let testCwd = "";

const ENV_KEYS = [
	"PI_CODING_AGENT_DIR",
	"PI_CONFIG_DIR",
	"OMP_PROFILE",
	"PI_PROFILE",
	"OMP_AUTH_BROKER_URL",
	"OMP_AUTH_BROKER_TOKEN",
] as const;
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

function profileAgentDir(profileName: string): string {
	return path.join(getProfileRootDir(profileName), "agent");
}

async function writeConfig(agentDir: string, config: Record<string, unknown>): Promise<void> {
	await fs.mkdir(agentDir, { recursive: true });
	await Bun.write(path.join(agentDir, "config.yml"), YAML.stringify(config, null, 2));
}
beforeEach(async () => {
	resetSettingsForTest();
	for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
	for (const key of ENV_KEYS) delete process.env[key];

	testRoot = await fs.mkdtemp(path.join(os.homedir(), ".omp-settings-profile-test-"));
	process.env.PI_CONFIG_DIR = path.basename(testRoot);
	testAgentDir = path.join(testRoot, "agent");
	testCwd = path.join(testRoot, "project");
	await fs.mkdir(testAgentDir, { recursive: true });
	await fs.mkdir(testCwd, { recursive: true });
	setAgentDir(testAgentDir);
});

afterEach(async () => {
	resetSettingsForTest();
	if (savedEnv.PI_CONFIG_DIR === undefined) delete process.env.PI_CONFIG_DIR;
	else process.env.PI_CONFIG_DIR = savedEnv.PI_CONFIG_DIR;

	if (savedEnv.PI_CODING_AGENT_DIR) {
		setAgentDir(savedEnv.PI_CODING_AGENT_DIR);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.PI_CODING_AGENT_DIR;
	}
	setProfile(savedEnv.OMP_PROFILE ?? savedEnv.PI_PROFILE);

	for (const key of ENV_KEYS) {
		if (savedEnv[key] === undefined) delete process.env[key];
		else process.env[key] = savedEnv[key];
	}

	await fs.rm(testRoot, { recursive: true, force: true });
});

describe("Settings profile integration", () => {
	it("loads default profile settings from the active config.yml", async () => {
		await writeConfig(testAgentDir, { modelRoles: { default: "anthropic/claude-opus" } });

		const instance = await Settings.init({ cwd: testCwd, agentDir: testAgentDir, inMemory: false });

		expect(instance.get("modelRoles")).toEqual({ default: "anthropic/claude-opus" });
		expect(instance.getProfileName()).toBe("default");
	});

	it("loads named profile settings from that profile's own config.yml only", async () => {
		const workAgentDir = profileAgentDir("work");
		await writeConfig(testAgentDir, {
			modelRoles: { default: "anthropic/claude-opus" },
			theme: { light: "github" },
		});
		await writeConfig(workAgentDir, { modelRoles: { default: "openai/gpt-5" } });

		const instance = await Settings.init({
			cwd: testCwd,
			agentDir: workAgentDir,
			inMemory: false,
			activeProfile: "work",
		});

		expect(instance.get("modelRoles")).toEqual({ default: "openai/gpt-5" });
		expect(instance.get("theme.light")).not.toBe("github");
		expect(instance.getProfileName()).toBe("work");
	});

	it("reloadForProfile() reads the new profile's own config.yml", async () => {
		const workAgentDir = profileAgentDir("work");
		const overlayPath = path.join(testRoot, "overlay.yml");
		await writeConfig(testAgentDir, { modelRoles: { default: "anthropic/claude" } });
		await writeConfig(workAgentDir, { modelRoles: { default: "openai/gpt-5" } });
		await Bun.write(overlayPath, YAML.stringify({ theme: { light: "dracula" } }, null, 2));

		const instance = await Settings.init({
			cwd: testCwd,
			agentDir: testAgentDir,
			inMemory: false,
			configFiles: [overlayPath],
		});
		instance.override("hideThinkingBlock", true);
		await instance.reloadForProfile("work");

		expect(instance.get("modelRoles")).toEqual({ default: "openai/gpt-5" });
		expect(instance.get("theme.light")).toBe("dracula");
		expect(instance.get("hideThinkingBlock")).toBe(true);
		expect(instance.getProfileName()).toBe("work");
		expect(instance.getAgentDir()).toBe(workAgentDir);
	});

	it("reloadForProfile() reopens the profile-scoped storage database", async () => {
		const workAgentDir = profileAgentDir("work");
		await writeConfig(testAgentDir, {});
		await writeConfig(workAgentDir, {});

		const instance = await Settings.init({ cwd: testCwd, agentDir: testAgentDir, inMemory: false });
		instance.getStorage()?.recordModelUsage("unit/default-model");

		await instance.reloadForProfile("work");
		instance.getStorage()?.recordModelUsage("unit/work-model");

		const defaultStorage = await AgentStorage.open(getAgentDbPath(testAgentDir));
		const workStorage = await AgentStorage.open(getAgentDbPath(workAgentDir));
		expect(defaultStorage.getModelUsageOrder()).toContain("unit/default-model");
		expect(defaultStorage.getModelUsageOrder()).not.toContain("unit/work-model");
		expect(workStorage.getModelUsageOrder()).toContain("unit/work-model");
		expect(workStorage.getModelUsageOrder()).not.toContain("unit/default-model");
	});
	it("auth broker config reads the active profile's own config.yml", async () => {
		const workAgentDir = profileAgentDir("work");
		await writeConfig(testAgentDir, {
			"auth.broker.url": "https://default-broker.example",
			"auth.broker.token": "default-token",
		});
		await writeConfig(workAgentDir, {
			"auth.broker.url": "https://work-broker.example",
			"auth.broker.token": "work-token",
		});
		setProfile("work");

		expect(await resolveAuthBrokerConfig()).toEqual({
			url: "https://work-broker.example",
			token: "work-token",
		});
	});
});
