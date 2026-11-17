import { expect, it } from "vitest";
import { annotationChoices } from "../src/annotation-search";
import type { Entry } from "../src/studio/language";

const concept = (name: string, label: string, description = ""): Entry => ({
  kind: "concept",
  name,
  label,
  description,
  type: "Concept",
  params: [],
});
const operator = (name: string, description: string): Entry => ({
  kind: "operator",
  name,
  description,
  type: "Real",
  params: [],
});
const concepts = [
  concept("Curve", "曲线", "直线、圆及双曲线的父概念"),
  concept("Line", "直线"),
  concept("Hyperbola", "双曲线"),
  concept("Circle", "圆"),
];

it("uses words inside the selected text and puts the specific concept before frequent generic matches", () => {
  expect(
    annotationChoices(concepts, "concept", "", "已知直线AB", { Curve: 9999 })[0]
      .name,
  ).toBe("Line");
  expect(
    annotationChoices(concepts, "concept", "", "双曲线C", { Curve: 9999 })[0]
      .name,
  ).toBe("Hyperbola");
  expect(annotationChoices(concepts, "concept", "", "已知圆O")[0].name).toBe(
    "Circle",
  );
});

it("ranks descriptions by keyword coverage and ignores unrelated frequent operators", () => {
  const entries = [
    operator("point_line_distance", "点到直线的距离。"),
    { ...operator("length", "两点之间的距离。"), label: "距离" },
    operator("foot_point", "点在直线上的垂足。"),
    operator("count", "集合元素的个数。"),
    ...concepts,
  ];
  const choices = annotationChoices(
    entries,
    "operator",
    "",
    "求点P到直线l的距离",
    { length: 1000, count: 10000 },
  );
  expect(choices[0].name).toBe("point_line_distance");
  expect(choices.map((entry) => entry.name)).not.toContain("count");
  expect(choices.every((entry) => entry.kind === "operator")).toBe(true);
  expect(
    annotationChoices(
      [
        { ...operator("line", "构造直线"), label: "直线" },
        { ...operator("tangent", "判断直线与圆是否相切"), label: "相切" },
      ],
      "operator",
      "",
      "直线与圆相切",
    )[0].name,
  ).toBe("tangent");
});

it("uses input and output descriptions as clues and gives a full description match priority over one keyword", () => {
  const entries = [
    { ...operator("solve", ""), returnDescription: "两条曲线的交点集合" },
    {
      ...operator("make", ""),
      params: [{ name: "value", type: "Real", description: "非零正数" }],
    },
    operator("inspect", "判断曲线是否封闭"),
  ];
  expect(annotationChoices(entries, "operator", "", "曲线交点")[0].name).toBe(
    "solve",
  );
  expect(annotationChoices(entries, "operator", "", "非零正数")[0].name).toBe(
    "make",
  );
});

it("lets a typed name or pinyin override the selected phrase and returns no unrelated fallback", () => {
  expect(
    annotationChoices(concepts, "concept", "sqx", "直线AB").map(
      (entry) => entry.name,
    ),
  ).toContain("Hyperbola");
  expect(annotationChoices(concepts, "concept", "sqx", "直线AB")[0].name).toBe(
    "Hyperbola",
  );
  expect(annotationChoices(concepts, "concept", "", "未收录术语")).toEqual([]);
  expect(annotationChoices(concepts, "concept", "", "spline")).toEqual([]);
});
