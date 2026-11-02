import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [require.resolve("next")] }));
const asset = name => fileURLToPath(new URL(`../public/brand/${name}`, import.meta.url));

for (const name of ["studyflow-icon-book", "studyflow-icon-book-white"]) {
  const svg = await readFile(asset(`${name}.svg`), "utf8");
  assert(!/<(?:text|image|foreignObject)\b/.test(svg));
  assert.equal((svg.match(/<path\b/g) ?? []).length, 2);
  await sharp(asset(`${name}.svg`)).resize(1024, 1024).png().toFile(asset(`${name}.png`));
  const metadata = await sharp(asset(`${name}.png`)).metadata();
  const pixels = await sharp(asset(`${name}.png`)).ensureAlpha().raw().toBuffer();
  assert(metadata.hasAlpha);
  assert.equal(pixels[3], 0);
  console.log(`${name}: verified two vector paths and transparent 1024 × 1024 PNG`);
}

const small = await sharp(asset("studyflow-icon-book.svg")).resize(24, 24).png().toBuffer();
const large = await sharp(asset("studyflow-icon-book.svg")).resize(256, 256).png().toBuffer();
await sharp({ create: { width: 640, height: 360, channels: 4, background: "#FFFFFF" } })
  .composite([{ input: large, left: 64, top: 52 }, { input: small, left: 440, top: 168 }])
  .png().toFile(asset("studyflow-icon-book-proof.png"));

// PNG-backed ICO entries for modern browsers that still request /favicon.ico.
const sizes = [32, 48, 64];
const images = await Promise.all(sizes.map(size => sharp(asset("studyflow-icon-book.svg")).resize(size, size).png().toBuffer()));
const directory = Buffer.alloc(6 + 16 * sizes.length);
directory.writeUInt16LE(1, 2);
directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
images.forEach((image, index) => {
  const entry = 6 + index * 16;
  directory[entry] = sizes[index];
  directory[entry + 1] = sizes[index];
  directory.writeUInt16LE(1, entry + 4);
  directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(image.length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += image.length;
});
await writeFile(fileURLToPath(new URL("../app/favicon.ico", import.meta.url)), Buffer.concat([directory, ...images]));
console.log("Updated website favicon: 32, 48 and 64 pixel entries.");
