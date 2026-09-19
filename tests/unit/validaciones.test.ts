import { describe, it, expect } from "vitest";
import { telefonoValido } from "@/lib/pedidos/validaciones";

describe("telefonoValido", () => {
  it.each(["3764123456", "376 412-3456", "+54 9 376 412 3456", "5493764123456"])("acepta %s", (t) => {
    expect(telefonoValido(t)).toBe(true);
  });
  it.each(["", "12345", "376412345", "54937641234567", "abc"])("rechaza '%s'", (t) => {
    expect(telefonoValido(t)).toBe(false);
  });
});
