import { test } from "node:test";
import assert from "node:assert/strict";
import { getTechTreeLine } from "./curriculum.js";
import type { Bot } from "mineflayer";

test("a nearby placed crafting table counts toward the early tech ladder", () => {
  const bot = {
    inventory: { items: () => [{ name: "spruce_planks", count: 3 }, { name: "wooden_pickaxe", count: 1 }] },
    findBlock: () => ({ name: "crafting_table" }),
  } as unknown as Bot;
  const line = getTechTreeLine(bot);
  assert.match(line, /reached \[wood, crafting table, wooden tools\]/);
  assert.match(line, /NEXT MILESTONE: stone tools/);
});
