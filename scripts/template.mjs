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
const language = await Promise.all(
  (await fs.readdir(path.join(shared, "language")))
    .filter((name) => /\.(ts|langium|keh|json|md)$/.test(name))
    .map(async (name) => [
      name,
      await fs.readFile(path.join(shared, "language", name), "utf8"),
    ]),
);
// Only replace the two tracked template directories, after all source reads succeed.
for (const relative of ["initial/shared", "studio/language"]) {
  const target = path.resolve(relative);
  if (!target.startsWith(process.cwd() + path.sep) || target === shared)
    throw new Error("无效模板目录");
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });
}
await fs.mkdir("initial/shared/libraries", { recursive: true });
await fs.writeFile(
  "initial/shared/domains.json",
  JSON.stringify(domains, null, 2) + "\n",
);
for (const [name, text] of libraries)
  await fs.writeFile("initial/shared/libraries/" + name, text);
for (const [name, text] of language)
  await fs.writeFile("studio/language/" + name, text);
console.log(
  `已更新 ${domains.length} 个领域、${libraries.length} 个 CO 文件和 ${language.length} 个语言文件。`,
);
