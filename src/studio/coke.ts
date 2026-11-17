import type { Language } from "./engine";
import { domainSources } from "./domains";
import { scopedSources } from "./library-scope";
import type { CokeCase } from "./language";

export interface CokeResult {
  domain: string;
  id: string;
  title: string;
  confirmed: boolean;
  issues: { message: string; line: number }[];
}

/** Regression checks validate the language, not the truth of the natural-language mapping. */
export async function inspectCoke(
  language: Language,
  libraries: { id: string; name: string; text: string; parent?: string }[],
  domain: string,
  cases: CokeCase[],
): Promise<CokeResult[]> {
  const p = language.context(
    scopedSources(language, domainSources(libraries, domain)),
  );
  return Promise.all(
    cases.map(async (item) => {
      const source = item.co + "\n" + item.ke;
      const result = await language.inspect(source, 0, p, { enabled: false });
      return {
        domain,
        id: item.id,
        title: item.title,
        confirmed: item.confirmed,
        issues: result.issues
          .filter((i) => i.severity !== "warning")
          .map((i) => ({
            message: i.message,
            line: source.slice(0, i.start).split("\n").length,
          })),
      };
    }),
  );
}
