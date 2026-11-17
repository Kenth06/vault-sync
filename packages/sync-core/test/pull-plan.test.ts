import { ChangeRow } from "@vault-sync/protocol";
import { describe, expect, it } from "vitest";

import { conflictName } from "../src/plan/conflict-name.ts";
import { planPull } from "../src/plan/pull-plan.ts";
import { remoteDelta } from "../src/plan/remote-delta.ts";
import type { FileMeta } from "../src/types.ts";

const meta = (h: string): FileMeta => ({ hash: h.repeat(64).slice(0, 64), size: 1, mtime: 1 });
const map = (entries: Record<string, FileMeta>) => new Map(Object.entries(entries));

function row(seq: number, fields: Record<string, unknown>) {
  return ChangeRow.parse({
    seq,
    fromPath: null,
    hash: null,
    prevHash: null,
    size: null,
    mtime: null,
    deviceId: "dev_0123456789abcdef",
    at: 1000 + seq,
    ...fields,
  });
}

describe("remoteDelta", () => {
  it("keeps only the latest state per path and drops renamed-away sources", () => {
    const a = meta("a").hash;
    const b = meta("b").hash;
    const delta = remoteDelta([
      row(1, { op: "put", path: "x.md", hash: a, size: 3, mtime: 10 }),
      row(2, { op: "put", path: "x.md", hash: b, size: 4, mtime: 20 }),
      row(3, { op: "rename", path: "y.md", fromPath: "x.md", hash: b, size: 4, mtime: 20 }),
      row(4, { op: "put", path: "z.md", hash: a }),
      row(5, { op: "delete", path: "z.md" }),
    ]);
    expect(Object.fromEntries(delta)).toEqual({
      "x.md": null,
      "y.md": { hash: b, size: 4, mtime: 20 },
      "z.md": null,
    });
  });
});

describe("planPull", () => {
  const remote = new Map([["n.md", meta("r")]]);

  it("writes remote changes over untouched local files", () => {
    const actions = planPull({ remote, base: map({ "n.md": meta("b") }), local: map({ "n.md": meta("b") }) });
    expect(actions).toEqual([{ kind: "write", path: "n.md", remote: meta("r") }]);
  });

  it("adopts when local already matches remote", () => {
    const actions = planPull({ remote, base: map({}), local: map({ "n.md": meta("r") }) });
    expect(actions[0]?.kind).toBe("adopt");
  });

  it("flags a conflict when both sides changed", () => {
    const actions = planPull({ remote, base: map({ "n.md": meta("b") }), local: map({ "n.md": meta("l") }) });
    expect(actions).toEqual([{ kind: "conflict", path: "n.md", remote: meta("r") }]);
  });

  it("deletes untouched files the remote deleted, and keeps edited ones", () => {
    const deleted = new Map([["n.md", null]]);
    const base = map({ "n.md": meta("b") });
    expect(planPull({ remote: deleted, base, local: map({ "n.md": meta("b") }) })[0]?.kind).toBe("delete");
    expect(planPull({ remote: deleted, base, local: map({ "n.md": meta("l") }) })[0]?.kind).toBe("keep-local");
  });
});

describe("conflictName", () => {
  it("keeps folder and extension and adds device and time", () => {
    const date = new Date(2026, 10, 17, 9, 5);
    expect(conflictName("Notas/plan.md", "laptop", date)).toBe("Notas/plan (conflicto laptop 2026-11-17 0905).md");
    expect(conflictName("todo", "a:b", date)).toBe("todo (conflicto a-b 2026-11-17 0905)");
  });
});
