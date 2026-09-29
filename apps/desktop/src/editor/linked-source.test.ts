import { expect, it } from "vitest";
import { withLinkedSourcePlacement } from "./edl";
import type { EdlManifest } from "../project/contracts";

it("places and removes the linked video and source audio together", () => {
  const edl = { projectId: "p", sourceOnTimeline: true, audioOnTimeline: true } as EdlManifest;
  expect(withLinkedSourcePlacement(edl, false)).toMatchObject({ sourceOnTimeline: false, audioOnTimeline: false });
  expect(withLinkedSourcePlacement(edl, true)).toMatchObject({ sourceOnTimeline: true, audioOnTimeline: true });
});
