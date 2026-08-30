import fs from "node:fs";
const pkg=JSON.parse(fs.readFileSync(new URL("../package.json",import.meta.url),"utf8"));
const cargoUrl=new URL("../src-tauri/Cargo.toml",import.meta.url);const tauriUrl=new URL("../src-tauri/tauri.conf.json",import.meta.url);
const cargo=fs.readFileSync(cargoUrl,"utf8");const tauri=JSON.parse(fs.readFileSync(tauriUrl,"utf8"));
const cargoVersion=cargo.match(/^version = "([^"]+)"/m)?.[1];const ok=cargoVersion===pkg.version&&tauri.version===pkg.version;
if(process.argv.includes("--check")){if(!ok){console.error(`version mismatch package=${pkg.version} cargo=${cargoVersion} tauri=${tauri.version}`);process.exit(1);}}
else{fs.writeFileSync(cargoUrl,cargo.replace(/^version = "[^"]+"/m,`version = "${pkg.version}"`));tauri.version=pkg.version;fs.writeFileSync(tauriUrl,JSON.stringify(tauri,null,2)+"\n");}
