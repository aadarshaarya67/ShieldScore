const fs = require("node:fs");
const path = require("node:path");

const candidates = [
  path.join(process.cwd(), "node_modules", "node-tfhe", "tfhe_bg.wasm"),
  path.join(process.cwd(), "node_modules", "tfhe", "tfhe_bg.wasm"),
];

const source = candidates.find((candidate) => fs.existsSync(candidate));
if (!source) {
  throw new Error("Unable to find CoFHE TFHE wasm asset in node_modules");
}

const targets = [
  path.join(process.cwd(), ".next", "server", "chunks", "tfhe_bg.wasm"),
];

for (const target of targets) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`Copied ${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), target)}`);
}
