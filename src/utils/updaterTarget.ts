export type DesktopPlatform = "windows" | "darwin" | "linux";
export type DesktopArch = "x86_64" | "aarch64";
export type BundleKind = "nsis" | "msi" | "app" | "appimage" | "deb" | "rpm" | "unknown";

const allowedBundles: Record<DesktopPlatform, ReadonlySet<BundleKind>> = {
  windows: new Set(["nsis", "msi"]),
  darwin: new Set(["app"]),
  linux: new Set(["appimage", "deb", "rpm"]),
};

export function resolveUpdaterTarget(
  platform: DesktopPlatform,
  arch: DesktopArch,
  bundle: BundleKind,
): string | null {
  if (!allowedBundles[platform].has(bundle)) return null;
  return `${platform}-${arch}-${bundle}`;
}
