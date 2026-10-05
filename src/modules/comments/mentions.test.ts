import { describe, expect, it } from "vitest";
import { findMentions } from "./mentions";

const people = [
  { id: "1", name: "Ama Mensah", email: "ama.mensah@agod.test" },
  { id: "2", name: "Ama", email: "ama.k@agod.test" },
  { id: "3", name: "Kofi Boateng", email: "kofi.b@agod.test" },
];

describe("findMentions", () => {
  it("matches full names and email names, case-insensitively, longest first", () => {
    expect(findMentions("Thanks @ama mensah, can @Kofi.B check?", people).sort()).toEqual(["1", "3"]);
  });

  it("matches a short name only when it is not part of a longer word", () => {
    expect(findMentions("ping @Ama today", people)).toEqual(["2"]);
    expect(findMentions("ping @Amadou", people)).toEqual([]);
  });

  it("ignores people who are not mentioned and plain emails", () => {
    expect(findMentions("send to kofi.b@agod.test", people)).toEqual([]);
  });
});
