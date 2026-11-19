import fs from "node:fs/promises";
import path from "node:path";
const source = process.argv[2];
if (!source) throw new Error("用法：npm run template -- 本地工作区文件夹");
const shared = path.resolve(source, "shared");
const domains = JSON.parse(
  await fs.readFile(path.join(shared, "domains.json"), "utf8"),
);
const libraries = await Promise.all(
  domains.map(async (domain) => {
    if (!/^[\w-]+$/.test(domain.id)) throw new Error("无效领域 ID");
    return [
      domain.id + ".keh",
      await fs.readFile(
        path.join(shared, "libraries", domain.id + ".keh"),
        "utf8",
      ),
    ];
  }),
);
const target = path.resolve("initial/shared");
if (!target.startsWith(process.cwd() + path.sep) || target === shared)
  throw new Error("无效模板目录");
await fs.rm(target, { recursive: true, force: true });
await fs.mkdir("initial/shared/libraries", { recursive: true });
await fs.writeFile(
  "initial/shared/domains.json",
  JSON.stringify(domains, null, 2) + "\n",
);
for (const [name, text] of libraries)
  await fs.writeFile("initial/shared/libraries/" + name, text);
console.log(
  `已更新 ${domains.length} 个领域和 ${libraries.length} 个 CO 文件。`,
);
