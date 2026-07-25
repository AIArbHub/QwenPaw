/**
 * install.test.ts — validates the public window.AIArb.chat API surface.
 *
 * Focuses on the sugar/wiring layer in install.ts; the underlying registry
 * mechanics (LIFO, audit, disposeAll) are covered by chatExtensions.test.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type React from "react";
import { installHostSdk } from "./install";
import { installHostExternals } from "../hostExternals";
import { chatExtensions } from "../registry/chatExtensions";
import { auditStore } from "../registry/audit";

beforeEach(() => {
  // Reset the window.AIArb namespace before each test so installHostSdk
  // attaches fresh references.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).AIArb = undefined;
  installHostExternals();
  installHostSdk();
  chatExtensions.__resetForTests();
  auditStore.clear();
});

describe("window.AIArb.chat.welcome", () => {
  it("set(partial) writes multiple scalar fields", () => {
    window.AIArb.chat!.welcome.set("p1", {
      greeting: "Hi",
      avatar: "/a.png",
    });
    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["welcome.greeting"]?.value).toBe("Hi");
    expect(snap["welcome.avatar"]?.value).toBe("/a.png");
    expect(snap["welcome.nick"]).toBeUndefined();
  });

  it("set() returns a Disposable that reverts every field it wrote", () => {
    const d = window.AIArb.chat!.welcome.set("p1", {
      greeting: "Hi",
      avatar: "/a.png",
    });
    d.dispose();
    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["welcome.greeting"]).toBeUndefined();
    expect(snap["welcome.avatar"]).toBeUndefined();
  });

  it("set() from different plugins on different fields coexist (no overwrite)", () => {
    window.AIArb.chat!.welcome.set("p1", { greeting: "P1 hi" });
    window.AIArb.chat!.welcome.set("p2", { avatar: "/p2.png" });
    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["welcome.greeting"]?.pluginId).toBe("p1");
    expect(snap["welcome.avatar"]?.pluginId).toBe("p2");
  });

  it("render(node) writes a welcome.render scalar", () => {
    window.AIArb.chat!.welcome.render("p1", "<plain node>");
    const entry = chatExtensions.getScalarSnapshot()["welcome.render"];
    expect(entry?.pluginId).toBe("p1");
    expect(typeof entry?.value).toBe("function");
  });

  it("render(fn) keeps the fn as-is", () => {
    const fn = () => null as never;
    window.AIArb.chat!.welcome.render("p1", fn);
    expect(chatExtensions.getScalarSnapshot()["welcome.render"]?.value).toBe(
      fn,
    );
  });
});

describe("window.AIArb.chat.leftHeader", () => {
  it("set(partial) writes header.leftLogo / header.leftTitle", () => {
    window.AIArb.chat!.leftHeader.set("p1", {
      title: "MyApp",
      logo: "/logo.png",
    });
    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["header.leftTitle"]?.value).toBe("MyApp");
    expect(snap["header.leftLogo"]?.value).toBe("/logo.png");
  });

  it("render(node) writes header.leftHeader.render scalar", () => {
    window.AIArb.chat!.leftHeader.render("p1", "<custom>");
    expect(
      chatExtensions.getScalarSnapshot()["header.leftHeader.render"]?.value,
    ).toBe("<custom>");
  });
});

describe("window.AIArb.chat.theme / sender", () => {
  it("theme.set(partial) writes theme.colorPrimary", () => {
    window.AIArb.chat!.theme.set("p1", { colorPrimary: "#123456" });
    expect(
      chatExtensions.getScalarSnapshot()["theme.colorPrimary"]?.value,
    ).toBe("#123456");
  });

  it("sender.set(partial) writes placeholder and disclaimer", () => {
    window.AIArb.chat!.sender.set("p1", {
      placeholder: "Ask anything",
      disclaimer: "Beta",
    });
    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["sender.placeholder"]?.value).toBe("Ask anything");
    expect(snap["sender.disclaimer"]?.value).toBe("Beta");
  });

  it("sender.addPrefix appends to sender.prefix list", () => {
    window.AIArb.chat!.sender.addPrefix("p1", "<icon>");
    const list = chatExtensions.getListSnapshot()["sender.prefix"];
    expect(list).toHaveLength(1);
    expect(list[0].pluginId).toBe("p1");
  });
});

describe("window.AIArb.chat.rightHeader / actions", () => {
  it("rightHeader.add appends, never replaces", () => {
    window.AIArb.chat!.rightHeader.add("p1", "btn1", { order: 200 });
    window.AIArb.chat!.rightHeader.add("p2", "btn2", { order: 300 });
    const list = chatExtensions.getListSnapshot()["header.rightHeader"];
    expect(list.map((e) => e.pluginId)).toEqual(["p1", "p2"]);
  });

  it("actions.add and requestActions.add are separate lists", () => {
    window.AIArb.chat!.actions.add("p1", { id: "a1", onClick: () => {} });
    window.AIArb.chat!.requestActions.add("p1", {
      id: "r1",
      onClick: () => {},
    });
    const snap = chatExtensions.getListSnapshot();
    expect(snap.actions.map((e) => e.item.id)).toEqual(["a1"]);
    expect(snap.requestActions.map((e) => e.item.id)).toEqual(["r1"]);
  });
});

describe("window.AIArb.chat.requestPayload", () => {
  it("add writes a request payload transform list entry", () => {
    const transform = ({ payload }: { payload: Record<string, unknown> }) => ({
      ...payload,
      request_context: { source: "test" },
    });

    window.AIArb.chat!.requestPayload.add("p1", transform, {
      id: "p1.payload",
      order: 25,
    });

    const list = chatExtensions.getListSnapshot()["request.payloadTransforms"];
    expect(list).toHaveLength(1);
    expect(list[0].pluginId).toBe("p1");
    expect(list[0].item.id).toBe("p1.payload");
    expect(list[0].item.order).toBe(25);
    expect(list[0].item.transform).toBe(transform);
  });
});

describe("window.AIArb.host.* hooks attached", () => {
  it("attaches the four hooks + fetch + imperative getters", () => {
    expect(typeof window.AIArb.host.useTheme).toBe("function");
    expect(typeof window.AIArb.host.useLocale).toBe("function");
    expect(typeof window.AIArb.host.useSelectedAgent).toBe("function");
    expect(typeof window.AIArb.host.useCurrentSession).toBe("function");
    expect(typeof window.AIArb.host.getSelectedAgentId).toBe("function");
    expect(typeof window.AIArb.host.getCurrentSessionId).toBe("function");
    expect(typeof window.AIArb.host.fetch).toBe("function");
  });
});

describe("window.AIArb.audit", () => {
  it("overrides() returns the audit ring buffer", () => {
    window.AIArb.chat!.welcome.set("p1", { greeting: "Hi" });
    const records = window.AIArb.audit!.overrides();
    expect(records.length).toBeGreaterThan(0);
    expect(records.some((r) => r.field === "welcome.greeting")).toBe(true);
  });
});

describe("window.AIArb.chat.request / response", () => {
  it("request.render writes a request.render scalar", () => {
    const fn = ({ fallback }: { fallback: () => React.ReactElement }) =>
      fallback();
    window.AIArb.chat!.request.render("p1", fn);
    expect(chatExtensions.getScalarSnapshot()["request.render"]?.value).toBe(
      fn,
    );
  });

  it("response.render writes a response.render scalar", () => {
    const fn = ({ fallback }: { fallback: () => React.ReactElement }) =>
      fallback();
    window.AIArb.chat!.response.render("p1", fn);
    expect(chatExtensions.getScalarSnapshot()["response.render"]?.value).toBe(
      fn,
    );
  });

  it("response.set writes the assistant identity through welcome avatar/nick", () => {
    window.AIArb.chat!.response.set("p1", {
      avatar: "/bot.png",
      nick: "My Bot",
    });

    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["welcome.avatar"]?.value).toBe("/bot.png");
    expect(snap["welcome.nick"]?.value).toBe("My Bot");
  });

  it("request.prepend / append append to their respective lists", () => {
    const r1 = () => null;
    const r2 = () => null;
    window.AIArb.chat!.request.prepend("p1", r1, { id: "p1.pre" });
    window.AIArb.chat!.request.append("p1", r2, { id: "p1.post" });

    const snap = chatExtensions.getListSnapshot();
    expect(snap["request.prepend"].map((e) => e.item.id)).toEqual(["p1.pre"]);
    expect(snap["request.append"].map((e) => e.item.id)).toEqual(["p1.post"]);
  });

  it("response.prepend / append from multiple plugins coexist", () => {
    window.AIArb.chat!.response.prepend("p1", () => null, { id: "a" });
    window.AIArb.chat!.response.prepend("p2", () => null, { id: "b" });
    expect(
      chatExtensions
        .getListSnapshot()
        ["response.prepend"].map((e) => e.pluginId),
    ).toEqual(["p1", "p2"]);
  });

  it("returned Disposables actually clean up the slots", () => {
    const d = window.AIArb.chat!.request.prepend("p1", () => null, {
      id: "x",
    });
    expect(chatExtensions.getListSnapshot()["request.prepend"]).toHaveLength(1);
    d.dispose();
    expect(chatExtensions.getListSnapshot()["request.prepend"]).toHaveLength(0);
  });
});

describe("disposeAll", () => {
  it("clears every registration from the named plugin", () => {
    window.AIArb.chat!.welcome.set("p1", { greeting: "Hi", avatar: "/x" });
    window.AIArb.chat!.actions.add("p1", {
      id: "p1.a",
      onClick: () => {},
    });
    window.AIArb.chat!.actions.add("p2", {
      id: "p2.a",
      onClick: () => {},
    });

    window.AIArb.chat!.disposeAll("p1");

    const snap = chatExtensions.getScalarSnapshot();
    expect(snap["welcome.greeting"]).toBeUndefined();
    expect(snap["welcome.avatar"]).toBeUndefined();
    expect(
      chatExtensions.getListSnapshot().actions.map((e) => e.item.id),
    ).toEqual(["p2.a"]);
  });
});
