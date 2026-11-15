import { describe, expect, it } from "vitest";
import { cameraCrop, isPortraitEngine, portraitRegion } from "./geometry";
import { ema, nextJpegQuality } from "./rateControl";
import { CLOSE_BUSY, CLOSE_TAKEN_OVER, CLOSE_WRONG_TOKEN, MAX_RECONNECTS, closeOutcome } from "./connection";
import { cameraPacket, encodeMessage, parseResultPacket, parseServerMessage, serverSocketUrl } from "../services/protocol";

describe("geometry", () => {
  it("crops a wide camera to the model's shape, centred", () => {
    expect(cameraCrop(960, 540, 768, 432)).toEqual({ sx: 0, sy: 0, sw: 960, sh: 540 });
    const c = cameraCrop(960, 540, 576, 320); // slightly wider than 16:9
    expect(c.sw).toBe(960);
    expect(c.sh).toBe(Math.round(960 / (576 / 320)));
    expect(c.sy).toBe((540 - c.sh) / 2);
  });

  it("crops a camera that is too tall by its width instead", () => {
    const c = cameraCrop(540, 960, 768, 432);
    expect(c.sw).toBe(540);
    expect(c.sh).toBe(Math.round(540 / (768 / 432)));
  });

  it("pads an upright phone for a wide model, but not for a tall (phone) model or a wide camera", () => {
    const r = portraitRegion(540, 960, 768, 432);
    expect(r).not.toBeNull();
    expect(r!.rw).toBe(Math.round((432 * 540) / 960));
    expect(r!.rx).toBe(Math.round((768 - r!.rw) / 2));
    expect(portraitRegion(540, 960, 432, 768)).toBeNull();
    expect(portraitRegion(960, 540, 768, 432)).toBeNull();
    expect(portraitRegion(0, 0, 768, 432)).toBeNull();
    expect(isPortraitEngine(432, 768)).toBe(true);
    expect(isPortraitEngine(768, 432)).toBe(false);
  });
});

describe("rate control", () => {
  it("takes the first sample as it is, then smooths", () => {
    expect(ema(0, 100)).toBe(100);
    expect(ema(100, 200)).toBeCloseTo(120);
    expect(ema(100, 200, 0.9)).toBeCloseTo(110);
  });

  it("lowers quality when the round trip queues up, raises it when clear, within 0.5 to 0.8", () => {
    expect(nextJpegQuality(0.75, 400, 100)).toBeCloseTo(0.72);
    expect(nextJpegQuality(0.5, 400, 100)).toBe(0.5);
    expect(nextJpegQuality(0.75, 120, 100)).toBeCloseTo(0.76);
    expect(nextJpegQuality(0.8, 120, 100)).toBe(0.8);
    expect(nextJpegQuality(0.75, 230, 100)).toBe(0.75); // in between: unchanged
  });
});

describe("connection close", () => {
  it("reconnects after an unexpected drop of a live session, up to the limit", () => {
    expect(closeOutcome(1006, true, 0, true).kind).toBe("reconnect");
    expect(closeOutcome(1006, true, MAX_RECONNECTS, true).kind).toBe("stop");
    expect(closeOutcome(1006, true, 0, false).kind).toBe("stop");
  });

  it("does not reconnect after a deliberate close, and says why", () => {
    expect(closeOutcome(CLOSE_WRONG_TOKEN, true, 0, true)).toEqual({ kind: "stop", message: "Wrong access token." });
    expect((closeOutcome(CLOSE_TAKEN_OVER, true, 0, true) as { message: string }).message).toContain("took over");
    expect(closeOutcome(CLOSE_BUSY, false, 0, true)).toEqual({ kind: "stop", message: null });
  });

  it("tells a first-attempt failure from a dropped live session", () => {
    expect((closeOutcome(1006, false, 0, true) as { message: string }).message).toContain("Couldn't reach");
    expect((closeOutcome(1006, true, MAX_RECONNECTS, true) as { message: string }).message).toContain("dropped");
  });
});

describe("protocol", () => {
  it("encodes outgoing messages", () => {
    expect(JSON.parse(encodeMessage({ type: "prompt", text: "hi" }))).toEqual({ type: "prompt", text: "hi" });
  });

  it("builds the camera packet: 8 byte time, then the jpeg", async () => {
    const jpeg = new Uint8Array([1, 2, 3]).buffer;
    const buf = await cameraPacket(1234.5, jpeg).arrayBuffer();
    expect(buf.byteLength).toBe(11);
    expect(new DataView(buf).getFloat64(0, true)).toBe(1234.5);
    expect(Array.from(new Uint8Array(buf, 8))).toEqual([1, 2, 3]);
  });

  it("parses server messages and flags unknown ones", () => {
    expect(parseServerMessage('{"type":"ack","ts":5}')).toEqual({ type: "ack", ts: 5 });
    expect(parseServerMessage('{"type":"busy"}').type).toBe("busy");
    expect(parseServerMessage('{"type":"something-new"}').type).toBe("unknown");
  });

  it("parses an AI picture without a pose (browser must look itself)", () => {
    const buf = new ArrayBuffer(8 + 3);
    new DataView(buf).setFloat64(0, 42, true);
    new Uint8Array(buf, 8).set([9, 8, 7]);
    const r = parseResultPacket(buf, false);
    expect(r.ts).toBe(42);
    expect(r.pose).toBeUndefined();
    expect(Array.from(new Uint8Array(r.jpeg))).toEqual([9, 8, 7]);
  });

  it("parses an AI picture with a pose, and with 'nobody found'", () => {
    const lm = new Float32Array([0.1, 0.2, 0.3, 0.9, 0.4, 0.5, 0.6, 0.8]); // two landmarks
    const buf = new ArrayBuffer(12 + lm.byteLength + 2);
    const v = new DataView(buf);
    v.setFloat64(0, 7, true);
    v.setUint32(8, lm.byteLength, true);
    new Uint8Array(buf, 12, lm.byteLength).set(new Uint8Array(lm.buffer));
    new Uint8Array(buf, 12 + lm.byteLength).set([5, 6]);
    const r = parseResultPacket(buf, true);
    expect(r.pose).toHaveLength(2);
    expect(r.pose![0]!.visibility).toBeCloseTo(0.9);
    expect(r.pose![1]!.x).toBeCloseTo(0.4);
    expect(Array.from(new Uint8Array(r.jpeg))).toEqual([5, 6]);

    const none = new ArrayBuffer(12 + 2);
    new DataView(none).setFloat64(0, 8, true);
    new DataView(none).setUint32(8, 0, true);
    expect(parseResultPacket(none, true).pose).toBeNull();
  });

  it("builds the socket address", () => {
    expect(serverSocketUrl("https://a.b/c/", "tok")).toBe("wss://a.b/c/ws?token=tok");
    expect(serverSocketUrl("http://localhost:7861", "x")).toBe("ws://localhost:7861/ws?token=x");
  });
});
