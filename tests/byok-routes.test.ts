import { afterEach, describe, expect, it, vi } from "vitest";
import { directMusic } from "../server/music";
import { editMontage } from "../server/montage";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BYOK helper routes", () => {
  it("sends music director requests with an abort signal and clamps the returned spec", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          genre: "industrial",
                          bpm: 999,
                          rootNote: "C2",
                          scaleSemitones: [0, 3, "bad", 7],
                          tracks: Array.from({ length: 20 }, (_unused, index) => ({
                            name: `kick-${index}`,
                            role: "kick",
                            synth: "MembraneSynth",
                            notes: Array.from({ length: 500 }, () => 1)
                          })),
                          sections: [{ name: "drop", bars: 4, active: ["kick"] }]
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const result = await directMusic({
      baseURL: "http://proxy.test",
      apiKey: "test-key",
      model: "test-model",
      matchup: [{ name: "A" }]
    });

    expect(result.ok).toBe(true);
    expect(result.spec?.bpm).toBe(200);
    expect(result.spec?.scaleSemitones).toEqual([0, 3, 7]);
    expect(result.spec?.tracks).toHaveLength(12);
    expect((result.spec?.tracks?.[0] as { notes: unknown[] }).notes).toHaveLength(32);
  });

  it("sends montage editor requests with an abort signal and filters unknown moment ids", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        arguments: JSON.stringify({
                          title: "A clean cut",
                          order: ["m2", "unknown", "m1"],
                          slowmo: ["m1", "missing"]
                        })
                      }
                    }
                  ]
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const result = await editMontage({
      baseURL: "http://proxy.test/v1",
      apiKey: "test-key",
      model: "test-model",
      maxClips: 1,
      moments: [
        { id: "m1", type: "friendly_fire", t0: 0, t1: 1000 },
        { id: "m2", type: "epic_kill", t0: 1000, t1: 2000 }
      ]
    });

    expect(result).toMatchObject({
      refined: true,
      title: "A clean cut",
      order: ["m2"],
      slowmo: []
    });
  });
});
