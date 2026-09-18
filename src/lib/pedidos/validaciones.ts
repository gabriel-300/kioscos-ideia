// Validaciones puras compartidas entre el checkout (cliente) y
// crear-pedido-publico.ts (servidor) -- sin imports de servidor a propósito,
// así se pueden usar desde un Client Component.

// Acepta 10 dígitos (área sin 0 + número) hasta 13 (con 54/549 adelante).
export function telefonoValido(tel: string): boolean {
  const digitos = tel.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 13;
}
