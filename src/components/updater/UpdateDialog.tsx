import type { ReturnTypeUpdater } from "./types";
import type { Language } from "../../i18n";

export default function UpdateDialog({ updater, language }: { updater: ReturnTypeUpdater; language: Language }) {
  const { state } = updater;
  if (state.phase === "idle") return null;
  const l = (zh: string, en: string) => language === "en" ? en : zh;
  const title = state.phase === "checking" ? l("正在检查更新", "Checking for updates")
    : state.phase === "latest" ? l("当前已是最新版本", "You're up to date")
      : state.phase === "available" ? `${l("发现新版本", "Update available")} ${state.version}`
        : state.phase === "downloading" ? `${l("正在下载", "Downloading")} ${state.version}`
          : state.phase === "downloaded" ? l("签名验证完成，等待安装", "Signature verified; ready to install")
            : state.phase === "ready" ? l("更新已安装", "Update installed") : l("应用更新", "Application update");
  const error = language === "en" && /[\p{Script=Han}]/u.test(state.error) ? (state.error.match(/HTTP\s+\d+/i)?.[0].toLocaleUpperCase() ?? "Update failed. Retry or use the browser download.") : state.error;
  return <div className="update-surface" role="status">
    <div><strong>{title}</strong>{state.notes && <p>{state.notes}</p>}{error && <p className="account-error">{error}</p>}{state.phase === "downloading" && <progress max="100" value={state.progress ?? undefined}/>}</div>
    <div>
      {state.phase === "available" && <><button className="btn btn-secondary" onClick={() => void updater.skip()}>{l("跳过此版本", "Skip this version")}</button><button className="btn btn-secondary" onClick={updater.later}>{l("稍后", "Later")}</button><button className="btn btn-secondary" onClick={() => void updater.openRelease()}>{l("浏览器下载", "Browser download")}</button><button className="btn btn-primary" onClick={() => void updater.download()}>{l("下载更新", "Download update")}</button></>}
      {state.phase === "downloading" && <button className="btn btn-secondary" onClick={updater.cancel}>{l("取消", "Cancel")}</button>}
      {state.phase === "downloaded" && <><button className="btn btn-secondary" onClick={updater.later}>{l("稍后安装", "Install later")}</button><button className="btn btn-primary" onClick={() => void updater.installLinuxPackage()}>{l("安装更新", "Install update")}</button></>}
      {state.phase === "ready" && <><button className="btn btn-secondary" onClick={updater.later}>{l("稍后重启", "Restart later")}</button><button className="btn btn-primary" onClick={() => void updater.restart()}>{l("立即重启", "Restart now")}</button></>}
      {state.phase === "error" && <><button className="btn btn-secondary" onClick={updater.later}>{l("关闭", "Close")}</button><button className="btn btn-secondary" onClick={() => void updater.openRelease()}>{l("浏览器下载", "Browser download")}</button><button className="btn btn-primary" onClick={() => void updater.retry()}>{l("重试", "Retry")}</button></>}
      {["latest", "cancelled"].includes(state.phase) && <button className="btn btn-secondary" onClick={updater.later}>{l("关闭", "Close")}</button>}
    </div>
  </div>;
}
