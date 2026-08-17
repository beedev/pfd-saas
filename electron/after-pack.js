// electron-builder strips node_modules out of extraResources, which drops the
// Next standalone server's own node_modules (its `next` runtime) → the packaged
// app fails with "Cannot find module 'next'". Copy the whole .next/standalone
// tree — node_modules included — into the app Resources ourselves, after pack.
const fs = require('node:fs');
const path = require('node:path');

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename; // "Artha"
  const resources = path.join(context.appOutDir, `${appName}.app`, 'Contents', 'Resources');
  const src = path.join(context.packager.projectDir, '.next', 'standalone');
  const dst = path.join(resources, '.next', 'standalone');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  // Next's standalone traces the whole repo into itself (backups/docs/src/…,
  // even electron-dist → infinite recursion). Copy only the runtime essentials.
  const KEEP = new Set(['server.js', '.next', 'node_modules', 'package.json', 'public']);
  for (const entry of fs.readdirSync(src)) {
    if (!KEEP.has(entry)) continue;
    fs.cpSync(path.join(src, entry), path.join(dst, entry), { recursive: true, dereference: true });
  }
  const hasNext = fs.existsSync(path.join(dst, 'node_modules', 'next'));
  console.log(`[after-pack] copied .next/standalone → Resources (node_modules/next present: ${hasNext})`);
};
