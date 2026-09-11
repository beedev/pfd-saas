// electron-builder strips node_modules out of extraResources, which drops the
// Next standalone server's own node_modules (its `next` runtime) → the packaged
// app fails with "Cannot find module 'next'". Copy the whole .next/standalone
// tree — node_modules included — into the app Resources ourselves, after pack.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

exports.default = async function afterPack(context) {
  const appName = context.packager.appInfo.productFilename; // "Artha"
  const appPath = path.join(context.appOutDir, `${appName}.app`);
  const resources = path.join(appPath, 'Contents', 'Resources');
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

  // Next's standalone tree contains symlinks (notably under .next/node_modules/)
  // that point to ABSOLUTE build-machine paths (/Users/<you>/…). Those are (a)
  // rejected by codesign ("invalid destination for symbolic link") and (b)
  // DANGLING on any other Mac → the server can't load its external packages
  // (pglite/pdfjs/react-pdf) → it never starts → the app "installs but won't
  // open". Replace every symlink that escapes the bundle with a real copy of its
  // resolved target, so the bundle is self-contained, portable, and signable.
  let fixed = 0, dropped = 0, copied = 0;
  const relinkEscaping = (root) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, entry.name);
      if (entry.isSymbolicLink()) {
        let real;
        // NOTE: remove symlinks with unlinkSync — fs.rmSync follows a
        // symlink-to-directory and throws "Path is a directory".
        try { real = fs.realpathSync(p); } catch { fs.unlinkSync(p); dropped++; continue; }
        if (real.startsWith(appPath)) continue; // already resolves inside the bundle → fine
        // The target is (almost always) a package we already copied under
        // dst/node_modules. Map it back and re-point as a RELATIVE in-bundle link.
        const rel = path.relative(src, real);           // e.g. node_modules/@electric-sql/pglite
        const bundleTarget = path.join(dst, rel);
        fs.unlinkSync(p);
        if (rel && !rel.startsWith('..') && fs.existsSync(bundleTarget)) {
          fs.symlinkSync(path.relative(path.dirname(p), bundleTarget), p);
          fixed++;
        } else {
          // Target isn't in the bundle — fall back to a real (non-dereferencing) copy.
          try { fs.cpSync(real, p, { recursive: true }); copied++; } catch { dropped++; }
        }
      } else if (entry.isDirectory()) {
        relinkEscaping(p);
      }
    }
  };
  relinkEscaping(dst);
  console.log(`[after-pack] symlinks: ${fixed} re-pointed in-bundle, ${copied} copied, ${dropped} dropped`);

  // electron-builder skips signing (identity:null), and we just modified the
  // bundle — so it ships with NO valid code-signature seal. On the build Mac it
  // still runs (not quarantined), but on ANY OTHER Mac the app arrives
  // quarantined and Gatekeeper rejects the damaged/absent signature → "installs
  // but won't open". Ad-hoc sign the COMPLETE bundle now (last step, after all
  // file copies) so it carries a valid self-seal; combined with quarantine
  // removal at install time it launches on any Apple-Silicon Mac. (A paid
  // Developer-ID + notarization would remove the quarantine-removal step too.)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log('[after-pack] ad-hoc signed + verified bundle');
};
