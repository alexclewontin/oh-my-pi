/**
 * Tests for profile switching in session context:
 * ProfileChangeEntry persistence, branch isolation, and resume.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { SessionManager } from "../src/session/session-manager";

let tempDir = "";
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

const DEFAULT_PROFILE_LABEL = "default";

beforeEach(async () => {
	tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-profile-session-test-"));
	setAgentDir(path.join(tempDir, "agent"));
});
afterEach(async () => {
	if (originalAgentDir) {
		setAgentDir(originalAgentDir);
	} else {
		setAgentDir(fallbackAgentDir);
		delete process.env.PI_CODING_AGENT_DIR;
	}
	await fs.rm(tempDir, { recursive: true, force: true });
});

describe("session profile switching", () => {
	it("P1-P3/P7: in-memory sessions resolve the latest profile label", () => {
		for (const [changes, expected] of [
			[[], DEFAULT_PROFILE_LABEL],
			[["work"], "work"],
			[["personal", "work"], "work"],
			[[DEFAULT_PROFILE_LABEL], DEFAULT_PROFILE_LABEL],
		] as const) {
			const manager = SessionManager.inMemory();
			for (const profile of changes) manager.appendProfileChange(profile);
			expect(manager.buildSessionContext().profile).toBe(expected);
		}
	});

	it("P4: profile changes are branch-local", () => {
		const manager = SessionManager.create(tempDir, tempDir);

		// Append a message entry so we have a branch point before the profile change.
		const anchorId = manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });

		// Now set a profile on the main branch.
		manager.appendProfileChange("work");
		expect(manager.buildSessionContext().profile).toBe("work");

		// Branch back to before the profile change.
		manager.branch(anchorId);
		expect(manager.buildSessionContext().profile).toBe(DEFAULT_PROFILE_LABEL);

		// Diverge with a different profile on this new branch.
		manager.appendProfileChange("personal");
		expect(manager.buildSessionContext().profile).toBe("personal");
	});

	it("P5: resume restores saved profile", async () => {
		const manager = SessionManager.create(tempDir, tempDir);
		manager.appendModelChange("anthropic/claude-opus-4-5");
		manager.appendProfileChange("work");
		await manager.ensureOnDisk();

		const sessionFile = manager.getSessionFile();
		expect(sessionFile).toBeDefined();

		const resumed = await SessionManager.open(sessionFile!, tempDir);
		const ctx = resumed.buildSessionContext();
		expect(ctx.profile).toBe("work");
	});

	it("P6: two independent sessions maintain separate profiles", () => {
		const sessionA = SessionManager.inMemory();
		const sessionB = SessionManager.inMemory();

		sessionA.appendProfileChange("personal");
		sessionB.appendProfileChange("work");

		expect(sessionA.buildSessionContext().profile).toBe("personal");
		expect(sessionB.buildSessionContext().profile).toBe("work");
	});

	it("P8: profile switch can fork the branch into a target profile session dir", async () => {
		const sourceDir = path.join(tempDir, "default-sessions");
		const targetDir = path.join(tempDir, "work-sessions");
		const manager = SessionManager.create(tempDir, sourceDir);
		manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		await manager.ensureOnDisk();

		const oldSessionFile = manager.getSessionFile();
		expect(oldSessionFile).toBeDefined();
		const result = await manager.fork(targetDir);
		expect(result).toBeDefined();
		manager.appendProfileChange("work");
		await manager.ensureOnDisk();
		expect(path.dirname(result!.newSessionFile)).toBe(path.resolve(targetDir));
		expect(manager.getSessionDir()).toBe(path.resolve(targetDir));

		const original = await SessionManager.open(oldSessionFile!, sourceDir);
		const forked = await SessionManager.open(result!.newSessionFile, targetDir);

		expect(original.buildSessionContext().profile).toBe(DEFAULT_PROFILE_LABEL);
		expect(forked.buildSessionContext().profile).toBe("work");
	});
});
