import { expect, test, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

import { loginAsAdmin } from "./helpers/auth";

const ONE_BY_ONE_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=";

async function waitForAdminGameViewReady(page: Page): Promise<void> {
	await expect(page.locator("#game-tab-edit")).toHaveAttribute(
		"aria-busy",
		"false",
	);
	await expect(page.locator("#game-tab-settings")).toHaveAttribute(
		"aria-disabled",
		"false",
	);
}

async function setRangeInputValue(
	page: Page,
	selector: string,
	value: number,
): Promise<void> {
	await page.locator(selector).evaluate((element, nextValue) => {
		if (!(element instanceof HTMLInputElement)) {
			throw new Error("Expected range input element");
		}

		element.value = String(nextValue);
		element.dispatchEvent(new Event("input", { bubbles: true }));
		element.dispatchEvent(new Event("change", { bubbles: true }));
	}, value);
}

async function countStarterParticleEmission(
	page: Page,
	versionId: string,
): Promise<number> {
	return page.evaluate(async (gameVersionId) => {
		const runtimeWindow = window as Window & {
			__gameSpaceActiveGameRuntimeControls?: {
				serializeControlState?: () => { globals?: Record<string, number> };
			};
		};
		const starterModule = await import(
			`/games/${encodeURIComponent(gameVersionId)}/dist/game.js`
		);
		const createStarterDataSource = Reflect.get(
			starterModule,
			"createStarterDataSource",
		);
		const emitStarterParticles = Reflect.get(
			starterModule,
			"emitStarterParticles",
		);
		if (
			typeof createStarterDataSource !== "function" ||
			typeof emitStarterParticles !== "function"
		) {
			return 0;
		}

		const controlState =
			typeof runtimeWindow.__gameSpaceActiveGameRuntimeControls
				?.serializeControlState === "function"
				? runtimeWindow.__gameSpaceActiveGameRuntimeControls.serializeControlState()
				: {};
		const dataSource = createStarterDataSource({
			versionId: gameVersionId,
			loadControlState: () => Promise.resolve(controlState),
		});
		const loadedGame = await dataSource.loadGame(gameVersionId);
		const emitterThing = Array.isArray(loadedGame.game.things)
			? loadedGame.game.things[0]
			: null;
		if (!emitterThing || typeof emitterThing !== "object") {
			return 0;
		}

		let particleCount = 0;
		const game = {
			gameState: {
				things: [],
				blueprints: [],
				camera: { x: 0, y: 0 },
				screen: { width: 360, height: 640 },
				backgroundColor: "#020617",
				globals:
					loadedGame.game &&
					typeof loadedGame.game === "object" &&
					loadedGame.game.globals
						? loadedGame.game.globals
						: {},
			},
			collidingThingIds: new Map(),
			input: { touches: [], tapCount: 0 },
			spawn() {
				return null;
			},
			spawnParticle() {
				particleCount += 1;
			},
			destroy() {},
		};

		for (let tick = 0; tick < 20; tick += 1) {
			emitStarterParticles(emitterThing, game, () => 0.5);
		}

		return particleCount;
	}, versionId);
}

test("public game page hides manual tile snapshot capture controls", async ({
	page,
}) => {
	await page.goto("/game/starter");

	await expect(page.locator("#game-home-button")).toBeVisible();
	await expect(page.locator("#game-tab-capture-tile")).toHaveCount(0);
});

test("game page installs global iOS loupe prevention guards", async ({
	page,
}) => {
	await page.goto("/game/starter");

	const interactionGuardScript = await page
		.locator("script")
		.evaluateAll((scripts) =>
			scripts
				.map((script) => script.textContent ?? "")
				.find((content) => content.includes("lastTouchEndAt")) ?? "",
		);

	expect(interactionGuardScript).toContain("'touchstart'");
	expect(interactionGuardScript).toContain("'touchmove'");
	expect(interactionGuardScript).toContain("'gesturestart'");
});

test("game page does not log a favicon 404 console error on load", async ({
	page,
}) => {
	const errorMessages: string[] = [];
	page.on("console", (message) => {
		if (message.type() !== "error") {
			return;
		}

		errorMessages.push(message.text());
	});

	await page.goto("/game/starter");
	await expect(page.locator("#game-canvas")).toBeVisible();
	expect(
		errorMessages.some(
			(message) => message.includes("favicon.ico") && message.includes("404"),
		),
	).toBe(false);
});

test("starter game ships runtime settings metadata and loads canvas", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);
	await expect(page.locator("#game-canvas")).toBeVisible();

	const starterDefaults = await page.evaluate(async () => {
		const bundlePath = "/games/starter/dist/game.js";
		const starterModule = await import(bundlePath);
		const createStarterDataSource = Reflect.get(
			starterModule,
			"createStarterDataSource",
		);
		if (typeof createStarterDataSource !== "function") {
			return null;
		}

		const dataSource = createStarterDataSource();
		if (typeof dataSource !== "object" || dataSource === null) {
			return null;
		}

		const loadGame = Reflect.get(dataSource, "loadGame");
		if (typeof loadGame !== "function") {
			return null;
		}

		const loadedGame = await loadGame("starter");
		const game = Reflect.get(loadedGame, "game");
		if (typeof game !== "object" || game === null) {
			return null;
		}

		return {
			thingBlueprintNames: Array.isArray(Reflect.get(game, "things"))
				? Reflect.get(game, "things").map(
						(thing: { blueprintName?: unknown }) => thing.blueprintName,
					)
				: null,
			blueprintNames: Array.isArray(Reflect.get(game, "blueprints"))
				? Reflect.get(game, "blueprints").map(
						(blueprint: { name?: unknown }) => blueprint.name,
					)
				: null,
			camera: Reflect.get(game, "camera"),
			backgroundColor: Reflect.get(game, "backgroundColor"),
			globals: Reflect.get(game, "globals"),
			editor: Reflect.get(game, "editor"),
		};
	});

	expect(starterDefaults).toEqual({
		thingBlueprintNames: ["starter-particle-emitter"],
		blueprintNames: ["starter-particle-emitter"],
		camera: { x: 0, y: 0 },
		backgroundColor: "#020617",
		globals: { particles: 4 },
		editor: {
			sliders: [
				{
					id: "particles",
					label: "Particles",
					min: 1,
					max: 10,
					step: 1,
					globalKey: "particles",
					gameDevRequested: false,
				},
			],
		},
	});
});

test("game page passes a connected canvas to the starter module bootstrap", async ({
	page,
}) => {
	await page.route("**/games/starter/dist/game.js", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/javascript",
			body: `
        export function startGame(canvas) {
          const windowWithState = window;
          const isCanvas = canvas instanceof HTMLCanvasElement;
          windowWithState.__starterStartGameCanvasState = {
            isCanvas,
            isConnected: isCanvas ? canvas.isConnected : null,
            id: isCanvas ? canvas.id : null
          };
        }
      `,
		});
	});

	await page.goto("/game/starter");

	await expect
		.poll(async () => {
			return await page.evaluate(() => {
				const windowWithState = window as Window & {
					__starterStartGameCanvasState?: {
						isCanvas: boolean;
						isConnected: boolean | null;
						id: string | null;
					};
				};

				return windowWithState.__starterStartGameCanvasState ?? null;
			});
		})
		.toEqual({
			isCanvas: true,
			isConnected: true,
			id: "game-canvas",
		});
});

test("game page passes runtime host settings capabilities to the starter module bootstrap", async ({
	page,
}) => {
	await loginAsAdmin(page);

	await page.route("**/games/starter/dist/game.js", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/javascript",
			body: `
        export function startGame(canvas, host) {
          void canvas;
          window.__starterRuntimeHostState = {
            versionId: typeof host?.versionId === 'string' ? host.versionId : null,
            hasLoadControlState: typeof host?.loadControlState === 'function',
            hasSaveControlState: typeof host?.saveControlState === 'function'
          };
        }
      `,
		});
	});

	await page.goto("/game/starter");

	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const runtimeWindow = window as Window & {
					__starterRuntimeHostState?: {
						versionId: string | null;
						hasLoadControlState: boolean;
						hasSaveControlState: boolean;
					};
				};

				return runtimeWindow.__starterRuntimeHostState ?? null;
			});
		})
		.toEqual({
			versionId: "starter",
			hasLoadControlState: true,
			hasSaveControlState: true,
		});
});

test("game lifecycle teardown runs once across reload and unload via global handle", async ({
	page,
}) => {
	const storageKey = `starter-lifecycle-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

	await page.route("**/games/starter/dist/game.js", async (route) => {
		await route.fulfill({
			status: 200,
			contentType: "application/javascript",
			body: `
        const COUNTS_KEY = ${JSON.stringify(storageKey)};

        function readCounts() {
          try {
            const raw = localStorage.getItem(COUNTS_KEY);
            if (!raw) {
              return { startCalls: 0, teardownCalls: 0, lastCanvasId: null };
            }

            const parsed = JSON.parse(raw);
            if (
              typeof parsed !== 'object' ||
              parsed === null ||
              typeof parsed.startCalls !== 'number' ||
              typeof parsed.teardownCalls !== 'number'
            ) {
              return { startCalls: 0, teardownCalls: 0, lastCanvasId: null };
            }

            return {
              startCalls: parsed.startCalls,
              teardownCalls: parsed.teardownCalls,
              lastCanvasId:
                typeof parsed.lastCanvasId === 'string' || parsed.lastCanvasId === null
                  ? parsed.lastCanvasId
                  : null
            };
          } catch {
            return { startCalls: 0, teardownCalls: 0, lastCanvasId: null };
          }
        }

        function writeCounts(counts) {
          localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
        }

        window.__starterLifecycleReadCounts = () => readCounts();

        export function startGame(canvas) {
          const counts = readCounts();
          counts.startCalls += 1;
          counts.lastCanvasId = canvas instanceof HTMLCanvasElement ? canvas.id : null;
          writeCounts(counts);

          return () => {
            const nextCounts = readCounts();
            nextCounts.teardownCalls += 1;
            writeCounts(nextCounts);
          };
        }
      `,
		});
	});

	async function readLifecycleState() {
		return page.evaluate(() => {
			const windowWithState = window as Window & {
				__starterLifecycleReadCounts?: () => {
					startCalls: number;
					teardownCalls: number;
					lastCanvasId: string | null;
				};
				__gameSpaceTeardownActiveGame?: () => void;
			};

			const countsReader = windowWithState.__starterLifecycleReadCounts;
			const counts = typeof countsReader === "function" ? countsReader() : null;
			return {
				counts,
				hasGlobalTeardownHandle:
					typeof windowWithState.__gameSpaceTeardownActiveGame === "function",
			};
		});
	}

	await page.goto("/game/starter");
	await expect
		.poll(async () => (await readLifecycleState()).counts)
		.toEqual({
			startCalls: 1,
			teardownCalls: 0,
			lastCanvasId: "game-canvas",
		});
	await expect
		.poll(async () => (await readLifecycleState()).hasGlobalTeardownHandle)
		.toBe(true);

	await page.goto("/game/starter?lifecycle=reload");
	await expect
		.poll(async () => (await readLifecycleState()).counts)
		.toEqual({
			startCalls: 2,
			teardownCalls: 1,
			lastCanvasId: "game-canvas",
		});

	const countsAfterUnloadSignals = await page.evaluate(() => {
		const windowWithState = window as Window & {
			__starterLifecycleReadCounts?: () => {
				startCalls: number;
				teardownCalls: number;
				lastCanvasId: string | null;
			};
			__gameSpaceTeardownActiveGame?: () => void;
		};

		window.dispatchEvent(new Event("beforeunload"));
		window.dispatchEvent(new Event("pagehide"));
		window.dispatchEvent(new Event("unload"));
		windowWithState.__gameSpaceTeardownActiveGame?.();
		windowWithState.__gameSpaceTeardownActiveGame?.();

		return windowWithState.__starterLifecycleReadCounts?.() ?? null;
	});

	expect(countsAfterUnloadSignals).toEqual({
		startCalls: 2,
		teardownCalls: 2,
		lastCanvasId: "game-canvas",
	});
});

test("dev live reload waits about three seconds before refreshing after a token change", async ({
	page,
}) => {
	let tokenReadCount = 0;
	await page.route("**/api/dev/reload-token/starter*", async (route) => {
		tokenReadCount += 1;
		await route.fulfill({
			status: 200,
			contentType: "text/plain",
			body: tokenReadCount === 1 ? "token-1" : "token-2",
		});
	});

	await page.goto("/game/starter");
	await expect(page.locator("#game-canvas")).toBeVisible();

	const liveReloadScriptPath = path.join(
		process.cwd(),
		"src/app/game/[versionId]/legacy/game-live-reload-client.js",
	);
	const liveReloadScriptSource = await fs.readFile(
		liveReloadScriptPath,
		"utf8",
	);

	await page.addScriptTag({ content: liveReloadScriptSource });

	await page.waitForTimeout(2500);
	expect(
		await page.evaluate(() => {
			const entry = performance.getEntriesByType("navigation")[0];
			return entry instanceof PerformanceNavigationTiming ? entry.type : null;
		}),
	).toBe("navigate");

	await expect
		.poll(
			async () =>
				await page.evaluate(() => {
					const entry = performance.getEntriesByType("navigation")[0];
					return entry instanceof PerformanceNavigationTiming
						? entry.type
						: null;
				}),
			{ timeout: 2500 },
		)
		.toBe("reload");
});

test("admin game page does not emit React hydration mismatch errors", async ({
	page,
}) => {
	await loginAsAdmin(page);

	const errorMessages: string[] = [];
	page.on("console", (message) => {
		if (message.type() !== "error") {
			return;
		}

		errorMessages.push(message.text());
	});

	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);
	await expect(page.locator("#prompt-record-button")).toBeVisible();
	expect(
		errorMessages.some(
			(message) =>
				message.includes("React error #418") ||
				message.includes(
					"A tree hydrated but some attributes of the server rendered HTML didn't match the client properties",
				),
		),
	).toBe(false);
});

test("admin game page places tile capture in edit panel and posts tile snapshot data", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);

	await expect(page.locator("#prompt-panel")).toHaveAttribute(
		"aria-hidden",
		"true",
	);
	await expect(
		page.locator(".game-tool-tabs #game-tab-capture-tile"),
	).toHaveCount(0);

	await page.locator("#game-tab-edit").dispatchEvent("click");
	await expect(page.locator("#prompt-panel")).toHaveAttribute(
		"aria-hidden",
		"false",
	);
	await expect(page.locator("#game-tab-capture-tile")).toBeVisible();
	await expect(page.locator("#game-tab-capture-tile")).toHaveCSS(
		"color",
		"rgb(247, 249, 255)",
	);

	const actionButtonIds = await page
		.locator("#prompt-form .prompt-action-row > button")
		.evaluateAll((elements) => elements.map((element) => element.id));
	const tileCaptureIndex = actionButtonIds.indexOf("game-tab-capture-tile");
	const deleteIndex = actionButtonIds.indexOf("game-tab-delete");
	expect(tileCaptureIndex).toBeGreaterThanOrEqual(0);
	expect(deleteIndex).toBeGreaterThanOrEqual(0);
	expect(tileCaptureIndex).toBeLessThan(deleteIndex);
	expect(deleteIndex).toBe(actionButtonIds.length - 1);

	let tileCaptureRequestBody: string | null = null;
	await page.route("**/api/games/starter/tile-snapshot", async (route) => {
		tileCaptureRequestBody = route.request().postData() ?? null;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				status: "ok",
				versionId: "starter",
				tileSnapshotPath: "/games/starter/snapshots/tile.png",
			}),
		});
	});

	await page.locator("#game-tab-capture-tile").dispatchEvent("click");

	await expect.poll(() => tileCaptureRequestBody).not.toBeNull();
	const tileCapturePayload = JSON.parse(tileCaptureRequestBody ?? "{}");
	expect(isRecord(tileCapturePayload)).toBe(true);
	if (!isRecord(tileCapturePayload)) {
		throw new Error("Tile capture payload must be an object");
	}
	const tilePngDataUrl = tileCapturePayload.tilePngDataUrl;
	expect(typeof tilePngDataUrl).toBe("string");
	expect(
		typeof tilePngDataUrl === "string" &&
			tilePngDataUrl.startsWith("data:image/png;base64,"),
	).toBe(true);
});

test("admin prompt draft persists across reload for the same game and clears after successful submit", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);
	await page.locator("#game-tab-edit").dispatchEvent("click");

	const promptDraft = `persisted draft ${Date.now().toString(36)}`;
	const draftStorageKey = "game-space:prompt-draft:starter";
	await page.locator("#prompt-input").fill(promptDraft);

	await expect
		.poll(async () => {
			return await page.evaluate((storageKey) => {
				return window.localStorage.getItem(storageKey);
			}, draftStorageKey);
		})
		.toBe(promptDraft);

	await page.reload();
	await expect(page.locator("#game-canvas")).toBeVisible();
	await waitForAdminGameViewReady(page);
	await page.locator("#game-tab-edit").dispatchEvent("click");
	await expect(page.locator("#prompt-input")).toHaveValue(promptDraft);

	let submittedPrompt: string | null = null;
	await page.route("**/api/games/starter/prompts", async (route) => {
		const requestBody = route.request().postData();
		if (typeof requestBody === "string") {
			try {
				const requestPayload = JSON.parse(requestBody);
				if (
					isRecord(requestPayload) &&
					typeof requestPayload.prompt === "string"
				) {
					submittedPrompt = requestPayload.prompt;
				}
			} catch {
				submittedPrompt = null;
			}
		}

		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({ forkId: "starter" }),
		});
	});

	await page.locator("#prompt-submit-button").click();
	await page.waitForLoadState("domcontentloaded");
	await expect(page.locator("#game-canvas")).toBeVisible();

	await expect
		.poll(async () => {
			return await page.evaluate((storageKey) => {
				return window.localStorage.getItem(storageKey);
			}, draftStorageKey);
		})
		.toBeNull();

	await page.locator("#game-tab-edit").dispatchEvent("click");
	await expect(page.locator("#prompt-input")).toHaveValue("");
	expect(submittedPrompt).toBe(promptDraft);
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readTileSnapshotPath(payload: unknown): string {
	if (!isRecord(payload)) {
		throw new Error("Tile snapshot response missing tileSnapshotPath");
	}

	const tileSnapshotPath = payload.tileSnapshotPath;
	if (typeof tileSnapshotPath !== "string" || tileSnapshotPath.length === 0) {
		throw new Error("Tile snapshot path must be a non-empty string");
	}

	return tileSnapshotPath;
}

async function createCopiedStarterGameFixture(
	prefix: string,
): Promise<{ versionId: string; gameDirectoryPath: string }> {
	const randomSuffix = Math.random().toString(36).slice(2, 10);
	const versionId = `${prefix}-${Date.now().toString(36)}-${randomSuffix}`;
	const gameDirectoryPath = path.resolve("games", versionId);
	const gameBundlePath = path.join(gameDirectoryPath, "dist", "game.js");
	const sourceBundlePath = path.resolve("games/starter/dist/game.js");
	const metadataPath = path.join(gameDirectoryPath, "metadata.json");
	await fs.mkdir(path.dirname(gameBundlePath), { recursive: true });
	await fs.copyFile(sourceBundlePath, gameBundlePath);
	await fs.writeFile(
		metadataPath,
		JSON.stringify(
			{
				id: versionId,
				parentId: "starter",
				createdTime: new Date().toISOString(),
				favorite: false,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);

	return {
		versionId,
		gameDirectoryPath,
	};
}

async function createStarterLineageFixture(prefix: string): Promise<{
	lineageRootId: string;
	lineageChildId: string;
	lineageRootDirectoryPath: string;
	lineageChildDirectoryPath: string;
}> {
	const randomSuffix = Math.random().toString(36).slice(2, 10);
	const lineageRootId = `${prefix}-root-${Date.now().toString(36)}-${randomSuffix}`;
	const lineageChildId = `${prefix}-child-${Date.now().toString(36)}-${randomSuffix}`;
	const bundleSourcePath = path.resolve("games/starter/dist/game.js");
	const sharedSnapshotBytes = Buffer.from(ONE_BY_ONE_PNG_BASE64, "base64");

	async function createVersion(options: {
		versionId: string;
		parentId: string;
		lineageId: string;
		threeWords: string;
		createdTime: string;
	}): Promise<string> {
		const gameDirectoryPath = path.resolve("games", options.versionId);
		await fs.mkdir(path.join(gameDirectoryPath, "dist"), { recursive: true });
		await fs.mkdir(path.join(gameDirectoryPath, "snapshots"), {
			recursive: true,
		});
		await fs.copyFile(
			bundleSourcePath,
			path.join(gameDirectoryPath, "dist", "game.js"),
		);
		await fs.writeFile(
			path.join(gameDirectoryPath, "snapshots", "tile.png"),
			sharedSnapshotBytes,
		);
		await fs.writeFile(
			path.join(gameDirectoryPath, "metadata.json"),
			JSON.stringify(
				{
					id: options.versionId,
					parentId: options.parentId,
					lineageId: options.lineageId,
					threeWords: options.threeWords,
					createdTime: options.createdTime,
				},
				null,
				2,
			) + "\n",
			"utf8",
		);

		return gameDirectoryPath;
	}

	const lineageRootDirectoryPath = await createVersion({
		versionId: lineageRootId,
		parentId: "starter",
		lineageId: lineageRootId,
		threeWords: "lineage-root-spark",
		createdTime: "2026-03-10T00:00:00.000Z",
	});
	const lineageChildDirectoryPath = await createVersion({
		versionId: lineageChildId,
		parentId: lineageRootId,
		lineageId: lineageRootId,
		threeWords: "lineage-child-glow",
		createdTime: "2026-03-11T00:00:00.000Z",
	});

	return {
		lineageRootId,
		lineageChildId,
		lineageRootDirectoryPath,
		lineageChildDirectoryPath,
	};
}

async function createNoSettingsGameFixture(
	prefix: string,
): Promise<{ versionId: string; gameDirectoryPath: string }> {
	const randomSuffix = Math.random().toString(36).slice(2, 10);
	const versionId = `${prefix}-${Date.now().toString(36)}-${randomSuffix}`;
	const gameDirectoryPath = path.resolve("games", versionId);
	const gameBundlePath = path.join(gameDirectoryPath, "dist", "game.js");
	const metadataPath = path.join(gameDirectoryPath, "metadata.json");
	const bundleSource = `export function startGame(canvas) {
  window.__gameSpaceNoSettingsFixtureStarted = true;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#123456";
    context.fillRect(0, 0, Math.max(1, canvas.width), Math.max(1, canvas.height));
  }

  return {
    teardown() {},
  };
}
`;

	await fs.mkdir(path.dirname(gameBundlePath), { recursive: true });
	await fs.writeFile(gameBundlePath, bundleSource, "utf8");
	await fs.writeFile(
		metadataPath,
		JSON.stringify(
			{
				id: versionId,
				parentId: "starter",
				createdTime: new Date().toISOString(),
				favorite: false,
			},
			null,
			2,
		) + "\n",
		"utf8",
	);

	return {
		versionId,
		gameDirectoryPath,
	};
}

test("manual tile capture returns unique tile URLs and homepage uses the latest path", async ({
	page,
}) => {
	const { versionId, gameDirectoryPath } =
		await createCopiedStarterGameFixture("e2e-manual-capture");
	const metadataPath = path.join(gameDirectoryPath, "metadata.json");

	async function captureTileSnapshotPath(): Promise<string> {
		const responsePromise = page.waitForResponse((response) => {
			return (
				response.request().method() === "POST" &&
				response
					.url()
					.includes(`/api/games/${encodeURIComponent(versionId)}/tile-snapshot`)
			);
		});

		await page.locator("#game-tab-capture-tile").dispatchEvent("click");
		const response = await responsePromise;
		expect(response.status()).toBe(200);
		const payload = await response.json();
		return readTileSnapshotPath(payload);
	}

	try {
		await loginAsAdmin(page);
		await page.goto(`/game/${encodeURIComponent(versionId)}`);
		await waitForAdminGameViewReady(page);
		await page.locator("#game-tab-edit").dispatchEvent("click");
		await expect(page.locator("#game-tab-capture-tile")).toBeVisible();

		const firstTileSnapshotPath = await captureTileSnapshotPath();
		await expect(page.locator("#game-tab-capture-tile")).toBeEnabled();
		const secondTileSnapshotPath = await captureTileSnapshotPath();
		expect(secondTileSnapshotPath).not.toBe(firstTileSnapshotPath);

		const metadataPayloadRaw = JSON.parse(
			await fs.readFile(metadataPath, "utf8"),
		);
		expect(isRecord(metadataPayloadRaw)).toBe(true);
		if (!isRecord(metadataPayloadRaw)) {
			throw new Error("Game metadata payload must be an object");
		}
		const metadataPayload = metadataPayloadRaw;
		expect(metadataPayload.tileSnapshotPath).toBe(secondTileSnapshotPath);

		await page.goto("/");
		await expect(
			page.locator(`.game-tile[data-version-id="${versionId}"] .tile-image`),
		).toHaveAttribute("src", secondTileSnapshotPath);
	} finally {
		await fs.rm(gameDirectoryPath, { recursive: true, force: true });
	}
});

test("homepage groups a lineage into one tile and lineage modal can play and delete clones", async ({
	page,
}) => {
	const {
		lineageRootId,
		lineageChildId,
		lineageRootDirectoryPath,
		lineageChildDirectoryPath,
	} = await createStarterLineageFixture("e2e-lineage");

	try {
		await loginAsAdmin(page);
		await page.goto("/");
		const lineageTile = page.locator(
			`.game-tile[data-lineage-id="${lineageRootId}"]`,
		);
		await expect(lineageTile).toHaveCount(1);
		await expect(lineageTile).toHaveAttribute("data-version-id", lineageChildId);

		await lineageTile.click();
		await expect(page).toHaveURL(
			new RegExp(`/game/${encodeURIComponent(lineageChildId)}$`),
		);
		await waitForAdminGameViewReady(page);

		await page.locator("#game-tab-edit").click();
		await page.locator("#game-tab-lineage").click();
		await expect(page.locator("#lineage-modal")).toHaveAttribute(
			"aria-hidden",
			"false",
		);
		await expect(
			page.locator('#lineage-list [data-lineage-row="true"]'),
		).toHaveCount(2);
		await expect(
			page.locator(
				`#lineage-list [data-lineage-row="true"][data-lineage-version-id="${lineageChildId}"]`,
			),
		).toHaveCSS("border-top-color", "rgb(243, 239, 226)");

		await page
			.locator(
				`#lineage-list [data-lineage-version-id="${lineageRootId}"] [data-lineage-action="play"]`,
			)
			.click();
		await expect(page).toHaveURL(
			new RegExp(`/game/${encodeURIComponent(lineageRootId)}$`),
		);
		await waitForAdminGameViewReady(page);

		await page.locator("#game-tab-edit").click();
		await page.locator("#game-tab-lineage").click();
		const acceptDeleteDialog = page.waitForEvent("dialog").then((dialog) => {
			return dialog.accept();
		});
		await page
			.locator(
				`#lineage-list [data-lineage-version-id="${lineageRootId}"] [data-lineage-action="delete"]`,
			)
			.click({ force: true });
		await acceptDeleteDialog;

		await expect(page).toHaveURL(
			new RegExp(`/game/${encodeURIComponent(lineageChildId)}$`),
		);
		await waitForAdminGameViewReady(page);
		await expect
			.poll(async () => {
				try {
					await fs.access(lineageRootDirectoryPath);
					return true;
				} catch {
					return false;
				}
			})
			.toBe(false);
	} finally {
		await fs.rm(lineageRootDirectoryPath, { recursive: true, force: true });
		await fs.rm(lineageChildDirectoryPath, { recursive: true, force: true });
	}
});

test("admin game page keeps the record button icon-only with rounded border styling", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);

	const recordButton = page.locator("#prompt-record-button");
	await expect(recordButton).toBeVisible();
	await expect(recordButton).toHaveText("");
	await expect(recordButton).toHaveCSS("border-top-left-radius", "999px");
	await expect(recordButton).toHaveCSS("border-top-width", "1px");
});

test("game page initializes yellow annotation stroke color for prompt drawing", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);

	const strokeStyle = await page
		.locator("#prompt-drawing-canvas")
		.evaluate((canvas) => {
			if (!(canvas instanceof HTMLCanvasElement)) {
				return null;
			}

			const context = canvas.getContext("2d");
			return context?.strokeStyle ?? null;
		});

	expect(strokeStyle).toBe("rgba(250, 204, 21, 0.95)");
});

test("admin game page toggles annotation drawing from the edit drawer paintbrush button", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);

	const annotationButton = page.locator("#game-tab-annotation");
	const drawingCanvas = page.locator("#prompt-drawing-canvas");

	await expect(drawingCanvas).toHaveAttribute("aria-hidden", "true");

	await page.locator("#game-tab-edit").dispatchEvent("click");
	await expect(annotationButton).toBeVisible();
	await expect(annotationButton).toHaveAttribute("aria-pressed", "false");

	await annotationButton.dispatchEvent("click");
	await expect(annotationButton).toHaveAttribute("aria-pressed", "true");
	await expect(drawingCanvas).toHaveAttribute("aria-hidden", "false");
	expect(
		await drawingCanvas.evaluate((canvas) => {
			return canvas.classList.contains("prompt-drawing-canvas--active");
		}),
	).toBe(true);

	await annotationButton.dispatchEvent("click");
	await expect(annotationButton).toHaveAttribute("aria-pressed", "false");
	await expect(drawingCanvas).toHaveAttribute("aria-hidden", "true");
	expect(
		await drawingCanvas.evaluate((canvas) => {
			return canvas.classList.contains("prompt-drawing-canvas--active");
		}),
	).toBe(false);
});

test("admin game toolbar separates build and settings drawers with synced aria state", async ({
	page,
}) => {
	await loginAsAdmin(page);
	await page.goto("/game/starter");
	await waitForAdminGameViewReady(page);

	const editToggle = page.locator("#game-tab-edit");
	const settingsToggle = page.locator("#game-tab-settings");
	const transcriptToggle = page.locator("#game-codex-toggle");
	const promptPanel = page.locator("#prompt-panel");
	const settingsPanel = page.locator("#settings-panel");
	const settingsForm = page.locator("#settings-form");
	const transcriptPanel = page.locator("#game-codex-transcript");
	const recordButton = page.locator("#prompt-record-button");

	await expect(editToggle).toHaveAttribute("aria-expanded", "false");
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
	await expect(transcriptToggle).toHaveAttribute("aria-expanded", "false");
	await expect(promptPanel).toHaveAttribute("aria-hidden", "true");
	await expect(settingsPanel).toHaveAttribute("aria-hidden", "true");
	await expect(transcriptPanel).toHaveAttribute("aria-hidden", "true");
	await expect(recordButton).toHaveText("");
	await expect(settingsToggle).toHaveAttribute("aria-disabled", "false");

	await settingsToggle.click();
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
	await expect(settingsPanel).toHaveAttribute("aria-hidden", "false");
	await expect(promptPanel).toHaveAttribute("aria-hidden", "true");
	await expect(settingsForm).toHaveCSS("overflow-y", "auto");
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const tabs = document
					.querySelector(".game-toolbar-main")
					?.closest(".game-bottom-tabs");
				const panel = document.getElementById("settings-panel");
				if (!(tabs instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
					return Number.POSITIVE_INFINITY;
				}

				const tabsRect = tabs.getBoundingClientRect();
				const panelRect = panel.getBoundingClientRect();
				const shift = window.innerHeight - tabsRect.bottom;
				return Math.abs(shift - panelRect.height);
			});
		})
		.toBeLessThanOrEqual(2);

	const settingsDrawerLayout = await page.evaluate(() => {
		const tabs = document.querySelector(".game-toolbar-main")?.closest(".game-bottom-tabs");
		const panel = document.getElementById("settings-panel");
		const editTab = document.getElementById("game-tab-edit");
		const settingsTab = document.getElementById("game-tab-settings");
		if (
			!(tabs instanceof HTMLElement) ||
			!(panel instanceof HTMLElement) ||
			!(editTab instanceof HTMLElement) ||
			!(settingsTab instanceof HTMLElement)
		) {
			return null;
		}

		const tabsRect = tabs.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		const editRect = editTab.getBoundingClientRect();
		const settingsRect = settingsTab.getBoundingClientRect();
		const shift = window.innerHeight - tabsRect.bottom;
		return {
			shift,
			panelHeight: panelRect.height,
			activeTabBottomGap: Math.abs(editRect.bottom - panelRect.top),
			tabTopOffset: Math.abs(editRect.top - settingsRect.top),
		};
	});
	expect(settingsDrawerLayout).not.toBeNull();
	expect(Math.abs(settingsDrawerLayout!.shift - settingsDrawerLayout!.panelHeight)).toBeLessThanOrEqual(2);
	expect(settingsDrawerLayout!.activeTabBottomGap).toBeLessThanOrEqual(4);
	expect(settingsDrawerLayout!.tabTopOffset).toBeLessThanOrEqual(1);

	const settingsHeightRatio = await settingsPanel.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return rect.height / window.innerHeight;
	});
	expect(settingsHeightRatio).toBeGreaterThan(0.15);
	expect(settingsHeightRatio).toBeLessThan(1 / 3);

	await page.evaluate(() => {
		const runtimeWindow = window as Window & {
			__gameSpaceActiveGameRuntimeControls?: {
				getSliders?: () => unknown[];
			};
		};

		const controls = runtimeWindow.__gameSpaceActiveGameRuntimeControls;
		if (!controls || typeof controls.getSliders !== "function") {
			throw new Error("Runtime settings controls unavailable");
		}

		controls.getSliders = () => {
			return Array.from({ length: 8 }, (_, index) => ({
					id: `generated-slider-${index}`,
					label: `Generated slider ${index + 1}`,
					min: 0,
					max: 10,
					step: 1,
					globalKey: `generated-slider-${index}`,
					gameDevRequested: false,
					value: index,
				}));
			};

		window.dispatchEvent(new Event("game-runtime-controls-changed"));
	});
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const tabs = document
					.querySelector(".game-toolbar-main")
					?.closest(".game-bottom-tabs");
				const panel = document.getElementById("settings-panel");
				if (!(tabs instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
					return Number.POSITIVE_INFINITY;
				}

				const tabsRect = tabs.getBoundingClientRect();
				const panelRect = panel.getBoundingClientRect();
				const shift = window.innerHeight - tabsRect.bottom;
				return Math.abs(shift - panelRect.height);
			});
		})
		.toBeLessThanOrEqual(2);

	const cappedSettingsDrawerLayout = await page.evaluate(() => {
		const tabs = document.querySelector(".game-toolbar-main")?.closest(".game-bottom-tabs");
		const panel = document.getElementById("settings-panel");
		const form = document.getElementById("settings-form");
		if (
			!(tabs instanceof HTMLElement) ||
			!(panel instanceof HTMLElement) ||
			!(form instanceof HTMLElement)
		) {
			return null;
		}

		const tabsRect = tabs.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		const shift = window.innerHeight - tabsRect.bottom;
		return {
			shift,
			panelHeight: panelRect.height,
			heightRatio: panelRect.height / window.innerHeight,
			formIsScrollable: form.scrollHeight > form.clientHeight + 1,
		};
	});
	expect(cappedSettingsDrawerLayout).not.toBeNull();
	expect(
		Math.abs(
			cappedSettingsDrawerLayout!.shift -
				cappedSettingsDrawerLayout!.panelHeight,
		),
	).toBeLessThanOrEqual(2);
	expect(cappedSettingsDrawerLayout!.heightRatio).toBeGreaterThan(0.3);
	expect(cappedSettingsDrawerLayout!.heightRatio).toBeLessThanOrEqual(1 / 3);
	expect(cappedSettingsDrawerLayout!.formIsScrollable).toBe(true);

	await editToggle.dispatchEvent("click");
	await expect(editToggle).toHaveAttribute("aria-expanded", "true");
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
	await expect(promptPanel).toHaveAttribute("aria-hidden", "false");
	await expect(settingsPanel).toHaveAttribute("aria-hidden", "true");
	await expect(transcriptToggle).toHaveAttribute("aria-expanded", "false");
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const tabs = document
					.querySelector(".game-toolbar-main")
					?.closest(".game-bottom-tabs");
				const panel = document.getElementById("prompt-panel");
				if (!(tabs instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
					return Number.POSITIVE_INFINITY;
				}

				const tabsRect = tabs.getBoundingClientRect();
				const panelRect = panel.getBoundingClientRect();
				const shift = window.innerHeight - tabsRect.bottom;
				return Math.abs(shift - panelRect.height);
			});
		})
		.toBeLessThanOrEqual(2);

	const promptDrawerShift = await page.evaluate(() => {
		const tabs = document.querySelector(".game-toolbar-main")?.closest(".game-bottom-tabs");
		const panel = document.getElementById("prompt-panel");
		if (!(tabs instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
			return null;
		}

		const tabsRect = tabs.getBoundingClientRect();
		const panelRect = panel.getBoundingClientRect();
		const shift = window.innerHeight - tabsRect.bottom;
		return {
			shift,
			panelHeight: panelRect.height,
		};
	});
	expect(promptDrawerShift).not.toBeNull();
	expect(Math.abs(promptDrawerShift!.shift - promptDrawerShift!.panelHeight)).toBeLessThanOrEqual(2);

	await transcriptToggle.dispatchEvent("click");
	await expect(transcriptToggle).toHaveAttribute("aria-expanded", "true");
	await expect(transcriptPanel).toHaveAttribute("aria-hidden", "false");

	await transcriptToggle.dispatchEvent("click");
	await expect(transcriptToggle).toHaveAttribute("aria-expanded", "false");
	await expect(transcriptPanel).toHaveAttribute("aria-hidden", "true");
	await expect(editToggle).toHaveAttribute("aria-expanded", "true");

	await editToggle.dispatchEvent("click");
	await expect(editToggle).toHaveAttribute("aria-expanded", "false");
	await expect(promptPanel).toHaveAttribute("aria-hidden", "true");
	await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
	await expect(settingsPanel).toHaveAttribute("aria-hidden", "true");
});

test("settings tab stays disabled when a game exposes no runtime settings", async ({
	page,
}) => {
	const { versionId, gameDirectoryPath } = await createNoSettingsGameFixture(
		"e2e-no-settings",
	);

	try {
		await loginAsAdmin(page);
		await page.goto(`/game/${encodeURIComponent(versionId)}`);
		await page.waitForFunction(
			() => document.body.dataset.gameReactHydrated === "true",
		);
		await page.waitForFunction(() => {
			const runtimeWindow = window as Window & {
				__gameSpaceNoSettingsFixtureStarted?: boolean;
			};

			return runtimeWindow.__gameSpaceNoSettingsFixtureStarted === true;
		});

		const settingsToggle = page.locator("#game-tab-settings");
		await expect(settingsToggle).toBeDisabled();
		await expect(settingsToggle).toHaveAttribute("aria-disabled", "true");
		await expect(settingsToggle).toHaveAttribute("aria-expanded", "false");
		await expect(page.locator("#settings-panel")).toHaveAttribute(
			"aria-hidden",
			"true",
		);
	} finally {
		await fs.rm(gameDirectoryPath, { recursive: true, force: true });
	}
});

test("particles slider persists across reloads and increases rendered particle density", async ({
	page,
}) => {
	const { versionId, gameDirectoryPath } = await createCopiedStarterGameFixture(
		"e2e-runtime-settings",
	);

	try {
		await loginAsAdmin(page);
		await page.goto(`/game/${encodeURIComponent(versionId)}`);
		await page.waitForFunction(
			() => document.body.dataset.gameReactHydrated === "true",
		);
		await expect
			.poll(async () => {
				return page.evaluate(() => {
					const runtimeWindow = window as Window & {
						__gameSpaceActiveGameRuntimeControls?: {
							getSliders?: () => unknown[];
						};
					};

					const getSliders =
						runtimeWindow.__gameSpaceActiveGameRuntimeControls?.getSliders;
					return typeof getSliders === "function" ? getSliders().length : 0;
				});
			})
			.toBe(1);

		await page.locator("#game-tab-settings").click();
		await expect(page.locator("#settings-panel")).toHaveAttribute(
			"aria-hidden",
			"false",
		);
		await expect(page.locator("#settings-slider-particles")).toHaveValue(
			"4",
		);

		await setRangeInputValue(page, "#settings-slider-particles", 1);
		await page.waitForTimeout(250);

		await page.reload();
		await page.waitForFunction(
			() => document.body.dataset.gameReactHydrated === "true",
		);
		await expect
			.poll(async () => {
				return page.evaluate(() => {
					const runtimeWindow = window as Window & {
						__gameSpaceActiveGameRuntimeControls?: {
							getSliders?: () => unknown[];
						};
					};

					const getSliders =
						runtimeWindow.__gameSpaceActiveGameRuntimeControls?.getSliders;
					return typeof getSliders === "function" ? getSliders().length : 0;
				});
			})
			.toBe(1);
		await page.locator("#game-tab-settings").click();
		await expect(page.locator("#settings-slider-particles")).toHaveValue(
			"1",
		);
		await page.waitForTimeout(700);
		const lowDensityPixels = await countStarterParticleEmission(
			page,
			versionId,
		);

		await setRangeInputValue(page, "#settings-slider-particles", 10);
		await page.waitForTimeout(250);

		await page.reload();
		await page.waitForFunction(
			() => document.body.dataset.gameReactHydrated === "true",
		);
		await expect
			.poll(async () => {
				return page.evaluate(() => {
					const runtimeWindow = window as Window & {
						__gameSpaceActiveGameRuntimeControls?: {
							getSliders?: () => unknown[];
						};
					};

					const getSliders =
						runtimeWindow.__gameSpaceActiveGameRuntimeControls?.getSliders;
					return typeof getSliders === "function" ? getSliders().length : 0;
				});
			})
			.toBe(1);
		await page.locator("#game-tab-settings").click();
		await expect(page.locator("#settings-slider-particles")).toHaveValue(
			"10",
		);
		await page.waitForTimeout(700);
		const highDensityPixels = await countStarterParticleEmission(
			page,
			versionId,
		);

		expect(highDensityPixels).toBeGreaterThan(lowDensityPixels);
	} finally {
		await fs.rm(gameDirectoryPath, { recursive: true, force: true });
	}
});
