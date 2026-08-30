import { describe, expect, it } from "vitest";
import { resolveUpdaterTarget } from "./updaterTarget";

describe("updater target", () => {
  it("keeps the installed package type in the signed manifest target", () => {
    expect(resolveUpdaterTarget("windows", "x86_64", "nsis")).toBe("windows-x86_64-nsis");
    expect(resolveUpdaterTarget("windows", "x86_64", "msi")).toBe("windows-x86_64-msi");
    expect(resolveUpdaterTarget("linux", "aarch64", "deb")).toBe("linux-aarch64-deb");
    expect(resolveUpdaterTarget("linux", "x86_64", "rpm")).toBe("linux-x86_64-rpm");
    expect(resolveUpdaterTarget("darwin", "aarch64", "app")).toBe("darwin-aarch64-app");
    expect(resolveUpdaterTarget("linux", "x86_64", "unknown")).toBeNull();
  });
});
