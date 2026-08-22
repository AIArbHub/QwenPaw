import { describe, expect, it } from "vitest";
import {
  directoriesMatch,
  normalizeDirectoryPath,
  workspaceRoots,
} from "./directorySources";

describe("directorySources", () => {
  it("normalizes separators and trailing slashes", () => {
    expect(normalizeDirectoryPath("/repo/aiarb/")).toBe("/repo/aiarb");
    expect(normalizeDirectoryPath("C:\\Repo\\AIArb\\")).toBe(
      "c:/repo/aiarb",
    );
  });

  it("compares Windows paths without case sensitivity", () => {
    expect(directoriesMatch("C:\\Repo\\AIArb", "c:/repo/aiarb/")).toBe(
      true,
    );
  });

  it("offers only the configuration root when both paths match", () => {
    expect(workspaceRoots(true)).toEqual(["workspace"]);
    expect(workspaceRoots(false)).toEqual(["project", "workspace"]);
  });
});
