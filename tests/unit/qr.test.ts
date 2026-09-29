import { describe, it, expect } from "vitest";
import { qrComoSvg } from "@/lib/pedidos/qr";
import { urlCatalogo } from "@/lib/pedidos/enlaces";

describe("qrComoSvg", () => {
  it("devuelve un SVG escalable", () => {
    const svg = qrComoSvg(urlCatalogo("d120dc6f-9754-46d0-94d0-a1fd5b05aa74"));
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("viewBox");
  });
  it("es determinista y distinto para cada enlace", () => {
    const a = urlCatalogo("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const b = urlCatalogo("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(qrComoSvg(a)).toBe(qrComoSvg(a));
    expect(qrComoSvg(a)).not.toBe(qrComoSvg(b));
  });
});
