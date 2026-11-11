import { createRequire } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));
const folder = resolve(dirname(fileURLToPath(import.meta.url)), "../public/brand");

for (const name of (await readdir(folder)).filter(name => name.endsWith(".svg"))) {
  const input = resolve(folder, name);
  const svg = await readFile(input, "utf8");
  assert(!/<(?:text|image|foreignObject)\b/.test(svg), `${name} must be self-contained vector paths`);
  const width = name.includes("mark") ? 1024 : 2400;
  const output = input.replace(/\.svg$/, ".png");
  await sharp(input).resize({ width }).png().toFile(output);
  const metadata = await sharp(output).metadata();
  assert(metadata.hasAlpha, `${name} must have a transparent background`);
  const { data } = await sharp(output).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, `${name} must have clear outer padding`);
  console.log(`${name.replace(/\.svg$/, ".png")}: ${metadata.width} × ${metadata.height}, RGBA`);
}

// A proof sheet is for reviewing contrast and small-size legibility only.
const backdrop = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="760"><rect width="1400" height="380" fill="#FFFFFF"/><rect y="380" width="1400" height="380" fill="#182230"/></svg>`);
const overlays = [];
for (const [name, top] of [["studyflow-logo", 92], ["studyflow-logo-dark", 472]]) {
  const large = await sharp(resolve(folder, `${name}.svg`)).resize({ width: 650 }).png().toBuffer();
  overlays.push({ input: large, left: 96, top });
}
for (const [name, top] of [["studyflow-mark", 274], ["studyflow-mark-white", 654]]) {
  let left = 110;
  for (const size of [24, 32, 48, 64]) {
    const icon = await sharp(resolve(folder, `${name}.svg`)).resize(size, size).png().toBuffer();
    overlays.push({ input: icon, left, top: top - size / 2 });
    left += size + 48;
  }
}
await sharp(backdrop).composite(overlays).png().toFile(resolve(folder, "studyflow-brand-preview.png"));
console.log("Verified six SVG masters and matching PNG exports. Proof sheet created.");
