import { describe, expect, it } from "vitest";
import { fieldsFromInfo, parseInfo } from "./prepare";
import { PrepareError, dataUrlToBlob, prepareGarment } from "../services/prepareApi";

const info = { wearable: true, kind: "top", name: "Maroon Dress Shirt", sleeves: "long", length: "full", hood: false, pattern: false, open_front: false };

describe("parseInfo", () => {
  it("reads a complete answer", () => {
    expect(parseInfo(info)).toEqual(info);
  });
  it("turns odd or missing values into safe defaults", () => {
    const p = parseInfo({ kind: "dress", sleeves: 5, name: "   ", hood: "yes" })!;
    expect(p.kind).toBe("top");
    expect(p.sleeves).toBe("short");
    expect(p.name).toBe("My clothing");
    expect(p.hood).toBe(false);
    expect(p.wearable).toBe(false);
  });
  it("rejects something that is not an object, and cuts a very long name", () => {
    expect(parseInfo(null)).toBeNull();
    expect(parseInfo("x")).toBeNull();
    expect(parseInfo({ name: "a".repeat(100) })!.name).toHaveLength(40);
  });
});

describe("fieldsFromInfo", () => {
  it("gives a top its sleeves, hood, pattern and open front, and no length", () => {
    const f = fieldsFromInfo(parseInfo({ ...info, hood: true, pattern: true, open_front: true })!);
    expect(f).toMatchObject({ category: "tshirts", sleeves: "long", hood: true, pattern: true, openFront: true });
    expect(f.length).toBeUndefined();
  });
  it("gives bottoms a length and no sleeves, hood or open front", () => {
    const f = fieldsFromInfo(parseInfo({ ...info, kind: "bottom", length: "short", hood: true, open_front: true })!);
    expect(f).toMatchObject({ category: "bottoms", length: "short", hood: false, openFront: false });
    expect(f.sleeves).toBeUndefined();
  });
});

const png = btoa("fakepng");
const okBody = { ok: true, info, image: "data:image/png;base64," + png };
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });

describe("prepareGarment", () => {
  const opts = (fetchImpl: typeof fetch) => ({ url: "https://x/prepare", token: "tok", fetchImpl });

  it("sends the picture with the token and returns the info and the flat picture", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify(okBody));
    }) as unknown as typeof fetch;
    const r = await prepareGarment(new Blob(["abc"]), opts(f));
    expect(seen!.url).toBe("https://x/prepare");
    expect(seen!.init.method).toBe("POST");
    expect((seen!.init.headers as Record<string, string>)["X-Token"]).toBe("tok");
    expect(r.info.name).toBe("Maroon Dress Shirt");
    expect(await r.image.text()).toBe("fakepng");
    expect(r.image.type).toBe("image/png");
  });

  it("shows the service's own message when it refuses", async () => {
    await expect(prepareGarment(new Blob(["a"]), opts(reply({ ok: false, error: "Too many pictures in a minute." }, 429) as never))).rejects.toThrow(
      "Too many pictures in a minute.",
    );
  });

  it("explains a network failure, an unreadable answer and an incomplete answer", async () => {
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    await expect(prepareGarment(new Blob(["a"]), opts(down))).rejects.toThrow("Could not reach");
    const html = (async () => new Response("<html>", { status: 502 })) as unknown as typeof fetch;
    await expect(prepareGarment(new Blob(["a"]), opts(html))).rejects.toThrow("unreadable");
    await expect(prepareGarment(new Blob(["a"]), opts(reply({ ok: true, info }) as never))).rejects.toBeInstanceOf(PrepareError);
  });

  it("gives up after the timeout", async () => {
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => {
        init.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
      })) as unknown as typeof fetch;
    await expect(prepareGarment(new Blob(["a"]), { ...opts(hang), timeoutMs: 20 })).rejects.toThrow("too long");
  });
});

describe("dataUrlToBlob", () => {
  it("decodes a base64 data URL and rejects anything else", async () => {
    const b = dataUrlToBlob("data:image/jpeg;base64," + btoa("hello"));
    expect(b.type).toBe("image/jpeg");
    expect(await b.text()).toBe("hello");
    expect(() => dataUrlToBlob("https://x/y.png")).toThrow(PrepareError);
  });
});
