-- Un local independiente (sucursales.catalogo_propio, migración 131) es de otra persona y no paga a IDEIA: su caja, sus ventas
-- y su stock no se mezclan con los de IDEIA, y tampoco entra en la Tesorería de IDEIA. Toda sucursal nueva nace con
-- entra_en_tesoreria = true, así que Paseo Bencivenga quedó adentro; se la saca y se pone una regla para que no vuelva a pasar.

update sucursales set entra_en_tesoreria = false where catalogo_propio and entra_en_tesoreria;

alter table sucursales
  drop constraint if exists sucursales_independiente_fuera_de_tesoreria;
alter table sucursales
  add constraint sucursales_independiente_fuera_de_tesoreria check (not (catalogo_propio and entra_en_tesoreria));
