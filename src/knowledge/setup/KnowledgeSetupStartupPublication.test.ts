import { publishKnowledgeSetupThenStudioAuthority } from "@/knowledge/setup/KnowledgeSetupStartupPublication";

describe("publishKnowledgeSetupThenStudioAuthority", () => {
  it("publishes presentation before the required Studio authority", () => {
    const calls: string[] = [];

    publishKnowledgeSetupThenStudioAuthority(
      "ready",
      () => calls.push("setup"),
      () => calls.push("authority")
    );

    expect(calls).toEqual(["setup", "authority"]);
  });

  it("still publishes Studio authority when optional setup projection fails", () => {
    const authority = jest.fn();

    expect(() =>
      publishKnowledgeSetupThenStudioAuthority(
        "recovery",
        () => {
          throw new Error("optional readiness failed");
        },
        authority
      )
    ).not.toThrow();

    expect(authority).toHaveBeenCalledWith("recovery");
  });

  it("does not hide an authoritative Studio publication failure", () => {
    expect(() =>
      publishKnowledgeSetupThenStudioAuthority(
        "ready",
        () => undefined,
        () => {
          throw new Error("authority failed");
        }
      )
    ).toThrow("authority failed");
  });
});
