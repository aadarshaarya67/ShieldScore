import fs from "node:fs";
import path from "node:path";

function copyCofheWasm(outputPath) {
  const candidates = [
    path.join(process.cwd(), "node_modules", "node-tfhe", "tfhe_bg.wasm"),
    path.join(process.cwd(), "node_modules", "tfhe", "tfhe_bg.wasm"),
  ];
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) return;

  fs.mkdirSync(outputPath, { recursive: true });
  fs.copyFileSync(source, path.join(outputPath, "tfhe_bg.wasm"));
}

class CopyCofheWasmPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap("CopyCofheWasmPlugin", () => {
      copyCofheWasm(compiler.outputPath);
    });
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    unoptimized: true,
  },
  outputFileTracingIncludes: {
    "/api/credit-authorization": ["./.next/server/chunks/tfhe_bg.wasm", "./node_modules/node-tfhe/tfhe_bg.wasm"],
  },
  webpack(config, { isServer }) {
    if (isServer) {
      config.plugins.push(new CopyCofheWasmPlugin());
    }
    return config;
  },
}

export default nextConfig
