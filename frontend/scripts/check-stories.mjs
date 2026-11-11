import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}
const stories = files(path.join(root, "stories"));
const imports = new Set();
for (const file of [...stories, ...files(path.join(root, ".storybook"))]) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const specifier = node.moduleSpecifier.text;
    if (specifier.startsWith("@/")) imports.add(path.join(root, specifier.slice(2)));
    else if (specifier.startsWith(".")) imports.add(path.resolve(path.dirname(file), specifier));
  }
}
const targets = [
  ...files(path.join(root, "components")).filter((file) => file.endsWith(".tsx") && !file.includes(".test.")),
  ...files(path.join(root, "app")).filter((file) => path.basename(file) === "page.tsx"),
];
const missing = targets.filter((file) => !imports.has(file.slice(0, -4)));
if (missing.length) {
  console.error("Add Storybook coverage for:\n" + missing.map((file) => path.relative(root, file)).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Storybook covers ${targets.length} component/page files in ${stories.filter((file) => file.endsWith(".stories.tsx")).length} story files.`);
}
