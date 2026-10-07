import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

interface ExtensionPackageManifest {
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies: Record<string, string>;
}

interface DevelopmentPackageFilter {
  source: string;
  autoload: boolean;
  extensions: string[];
  skills: string[];
}

interface ExtensionDevelopmentSettings {
  packages: DevelopmentPackageFilter[];
  extensions: string[];
}

interface ExtensionInstallLock {
  version: string;
  packages: Record<string, { version: string }>;
}

// These tracked JSON files are the integration fixture: mocking them would hide
// the fae13de release mismatch that made Pi's managed install dirty the checkout.
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as ExtensionPackageManifest;
const installLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8")) as ExtensionInstallLock;
const developmentSettings = JSON.parse(readFileSync(new URL("../.pi/settings.json", import.meta.url), "utf8")) as ExtensionDevelopmentSettings;

describe("published extension package metadata", () => {
  it("keeps root lock versions aligned with the released package", () => {
    assert.equal(installLock.version, manifest.version);
    assert.equal(installLock.packages[""].version, manifest.version);
  });

  it("suppresses installed upstream and fork extensions during local development", () => {
    for (const owner of ["HazAT", "re-miranda"]) {
      const filter = developmentSettings.packages.find(
        (entry) => entry.source === `git:github.com/${owner}/pi-interactive-subagents`,
      );
      assert.ok(filter, `Expected a filtering delta for installed ${owner} extension`);
      assert.equal(filter.autoload, false);
      assert.deepEqual(filter.extensions, ["!**"]);
      assert.deepEqual(filter.skills, ["!**"]);
    }
    assert.deepEqual(developmentSettings.extensions, ["../pi-extension/subagents/index.ts"]);
  });

  it("uses host-provided packages as wildcard peers, never runtime dependencies", () => {
    for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui", "typebox"]) {
      assert.equal(manifest.peerDependencies[name], "*");
      assert.equal(manifest.dependencies?.[name], undefined);
    }
  });
});
