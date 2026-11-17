import { describe, expect, it } from "vitest";

import {
  LinkIndex,
  isExternal,
  parseWikilink,
  splitFrontmatter,
  withoutLeadingTitle,
} from "../src/lib/markdown/links.ts";

describe("parseWikilink", () => {
  it("reads target, heading, alias and embeds", () => {
    expect(parseWikilink("[[Ideas/Plan#Goals|the plan]] rest")).toEqual({
      embed: false,
      target: "Ideas/Plan",
      heading: "Goals",
      label: "the plan",
    });
    expect(parseWikilink("![[diagram.png]]")).toMatchObject({
      embed: true,
      target: "diagram.png",
      label: "diagram.png",
    });
    expect(parseWikilink("[[Notes/Daily.md]]")?.label).toBe("Daily");
    expect(parseWikilink("not a link")).toBeNull();
  });
});

describe("LinkIndex", () => {
  const index = new LinkIndex(["Inbox.md", "Projects/Plan.md", "Archive/2024/Plan.md", "attachments/a b.png"]);

  it("resolves by name to the shortest path, like Obsidian", () => {
    expect(index.resolve("Plan", "Inbox.md")).toBe("Projects/Plan.md");
    expect(index.resolve("plan.md", "Inbox.md")).toBe("Projects/Plan.md");
  });

  it("prefers an explicit path and paths relative to the note", () => {
    expect(index.resolve("Archive/2024/Plan", "Inbox.md")).toBe("Archive/2024/Plan.md");
    expect(index.resolve("Plan.md", "Archive/2024/Notes.md")).toBe("Archive/2024/Plan.md");
  });

  it("decodes markdown link targets and reports missing notes", () => {
    expect(index.resolve("attachments/a%20b.png", "Inbox.md")).toBe("attachments/a b.png");
    expect(index.resolve("Nowhere", "Inbox.md")).toBeNull();
  });
});

describe("splitFrontmatter", () => {
  it("returns properties and the body", () => {
    const parts = splitFrontmatter('---\ntitle: "Plan"\ntags: work\n---\n# Body\n');
    expect(parts.properties).toEqual([
      ["title", "Plan"],
      ["tags", "work"],
    ]);
    expect(parts.body).toBe("# Body\n");
  });

  it("leaves text without frontmatter alone", () => {
    expect(splitFrontmatter("# Just text")).toEqual({ properties: [], body: "# Just text" });
  });
});

describe("isExternal", () => {
  it("separates URLs and anchors from vault paths", () => {
    expect(isExternal("https://example.com")).toBe(true);
    expect(isExternal("mailto:a@b.c")).toBe(true);
    expect(isExternal("#heading")).toBe(true);
    expect(isExternal("Notes/Plan.md")).toBe(false);
  });
});

describe("withoutLeadingTitle", () => {
  it("drops a first heading that repeats the file name", () => {
    expect(withoutLeadingTitle("# Plan\n\nBody", "plan")).toBe("\nBody");
    expect(withoutLeadingTitle("# Other\nBody", "Plan")).toBe("# Other\nBody");
    expect(withoutLeadingTitle("Body\n# Plan", "Plan")).toBe("Body\n# Plan");
  });
});
