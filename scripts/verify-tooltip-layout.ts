import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(
  root,
  "src/components/dashboard/panels/ConfigurationPanel.tsx",
);
const source = fs.readFileSync(configPath, "utf8");

const start = source.indexOf("{/* Add new provider */}");
const end = source.indexOf("const fleetConnectorsCard", start);
assert.notEqual(start, -1, "Add Model Provider form must exist");
assert.notEqual(end, -1, "Add Model Provider form boundary must exist");

const file = ts.createSourceFile(configPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const layoutNeutralControls: string[] = [];

function visit(node: ts.Node): void {
  if (
    ts.isJsxElement(node)
    && node.pos >= start
    && node.end <= end
    && node.openingElement.tagName.getText(file) === "Tooltip"
  ) {
    const asAttribute = node.openingElement.attributes.properties.find(
      property => ts.isJsxAttribute(property) && property.name.getText(file) === "as",
    );
    const directControl = node.children.find(
      child => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
    );
    if (
      asAttribute
      && ts.isJsxAttribute(asAttribute)
      && asAttribute.initializer?.getText(file) === '"div"'
      && directControl
    ) {
      layoutNeutralControls.push(
        ts.isJsxElement(directControl)
          ? directControl.openingElement.tagName.getText(file)
          : directControl.tagName.getText(file),
      );
    }
  }
  ts.forEachChild(node, visit);
}

visit(file);

for (const control of ["select", "input", "button"] as const) {
  const expectedCount = control === "input" ? 2 : 1;
  const actualCount = layoutNeutralControls.filter(tag => tag === control).length;
  assert.equal(
    actualCount,
    expectedCount,
    `every full-width ${control} in Add Model Provider must use a layout-neutral Tooltip wrapper`,
  );
}

console.log("Tooltip layout contract passed");
