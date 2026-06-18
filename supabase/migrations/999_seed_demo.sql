-- ============================================================
-- DATOS DE DEMO — Kioscos IDEIA
-- Correr en Supabase → SQL Editor → New query → Run
-- ⚠️  Solo para desarrollo/demo. No correr en producción.
-- ============================================================

-- ── CATEGORÍAS ──────────────────────────────────────────────

insert into public.categories (id, slug, name, description, sort_order, is_active) values
  ('c1000000-0000-0000-0000-000000000001', 'empanadas',  'Empanadas',        'Empanadas artesanales congeladas',        1, true),
  ('c1000000-0000-0000-0000-000000000002', 'milanesas',  'Milanesas',        'Milanesas y escalopes listos para freír', 2, true),
  ('c1000000-0000-0000-0000-000000000003', 'medallones', 'Medallones',       'Medallones de carne y pollo',             3, true),
  ('c1000000-0000-0000-0000-000000000004', 'rebozados',  'Rebozados',        'Nuggets, bastones y rebozados varios',    4, true),
  ('c1000000-0000-0000-0000-000000000005', 'pizzas',     'Pizzas y tartas',  'Pizzas y tartas congeladas',              5, true),
  ('c1000000-0000-0000-0000-000000000006', 'gaseosas',   'Gaseosas',         'Bebidas gaseosas en distintos tamaños',   6, true)
on conflict (id) do nothing;

-- ── PRODUCTOS — CONGELADOS ───────────────────────────────────

insert into public.products (
  id, sku, slug, name, short_description, category_id,
  price_b2c, price_b2b, unit_label, freezer_required, is_active,
  costo, precio_dist, precio_gastro, precio_min,
  pkg_unitario, pkg_bulto, bolsas_caja, kg_caja, mult_bolsas
) values
  -- Empanadas
  ('a0000000-0000-0000-0000-000000000001', 'EMP-CARNE-12', 'empanadas-de-carne-x12',
   'Empanadas de carne x12', 'Carne cortada a cuchillo, congeladas',
   'c1000000-0000-0000-0000-000000000001', 4800, 3600, 'docena', true, true,
   2200, 3000, 3300, 3600, 12, 10, 10, 6.0, false),

  ('a0000000-0000-0000-0000-000000000002', 'EMP-POLLO-12', 'empanadas-de-pollo-x12',
   'Empanadas de pollo x12', 'Pollo y verdura, congeladas',
   'c1000000-0000-0000-0000-000000000001', 4500, 3400, 'docena', true, true,
   2000, 2800, 3100, 3400, 12, 10, 10, 5.5, false),

  ('a0000000-0000-0000-0000-000000000003', 'EMP-JYQU-12', 'empanadas-jamon-queso-x12',
   'Empanadas jamón y queso x12', 'Jamón y queso, congeladas',
   'c1000000-0000-0000-0000-000000000001', 4600, 3500, 'docena', true, true,
   2100, 2900, 3200, 3500, 12, 10, 10, 5.8, false),

  -- Milanesas
  ('a0000000-0000-0000-0000-000000000004', 'MIL-TERN-500', 'milanesas-de-ternera-500g',
   'Milanesas de ternera 500g', 'Aprox. 4 unidades empanadas',
   'c1000000-0000-0000-0000-000000000002', 3200, 2400, 'pack 500g', true, true,
   1400, 2000, 2200, 2400, 4, 12, 12, 6.0, false),

  ('a0000000-0000-0000-0000-000000000005', 'MIL-POLL-500', 'milanesas-de-pollo-500g',
   'Milanesas de pollo 500g', 'Pechuga de pollo empanada',
   'c1000000-0000-0000-0000-000000000002', 3000, 2200, 'pack 500g', true, true,
   1200, 1800, 2000, 2200, 4, 12, 12, 6.0, false),

  -- Medallones
  ('a0000000-0000-0000-0000-000000000006', 'MED-CARNE-6', 'medallones-de-carne-x6',
   'Medallones de carne x6', 'Listos para asar o freír',
   'c1000000-0000-0000-0000-000000000003', 2800, 2100, 'pack x6', true, true,
   1200, 1750, 1950, 2100, 6, 12, 12, 4.8, false),

  ('a0000000-0000-0000-0000-000000000007', 'MED-POLL-6', 'medallones-de-pollo-x6',
   'Medallones de pollo x6', 'Con hierbas, listos para cocinar',
   'c1000000-0000-0000-0000-000000000003', 2600, 1950, 'pack x6', true, true,
   1100, 1600, 1800, 1950, 6, 12, 12, 4.2, false),

  -- Rebozados
  ('a0000000-0000-0000-0000-000000000008', 'NUG-POLL-500', 'nuggets-de-pollo-500g',
   'Nuggets de pollo 500g', 'Aprox. 20 unidades rebozadas',
   'c1000000-0000-0000-0000-000000000004', 2400, 1800, 'bolsa 500g', true, true,
   1000, 1500, 1650, 1800, 20, 15, 15, 7.5, true),

  ('a0000000-0000-0000-0000-000000000009', 'BAS-MUZZ-300', 'bastones-de-muzzarella-300g',
   'Bastones de muzzarella 300g', 'Queso muzzarella rebozado',
   'c1000000-0000-0000-0000-000000000004', 2200, 1650, 'bolsa 300g', true, true,
   900, 1350, 1500, 1650, 10, 15, 15, 4.5, true),

  -- Pizzas
  ('a0000000-0000-0000-0000-000000000010', 'PIZ-MUZZA-32', 'pizza-muzzarella-32cm',
   'Pizza muzzarella 32cm', 'Pre-horneada, diámetro 32cm',
   'c1000000-0000-0000-0000-000000000005', 5500, 4100, 'unidad', true, true,
   2500, 3400, 3800, 4100, 1, 6, 6, 7.2, false),

  ('a0000000-0000-0000-0000-000000000011', 'PIZ-ESP-32', 'pizza-especial-32cm',
   'Pizza especial 32cm', 'Jamón, morrones y aceitunas',
   'c1000000-0000-0000-0000-000000000005', 6200, 4600, 'unidad', true, true,
   2800, 3800, 4200, 4600, 1, 6, 6, 7.8, false)
on conflict (id) do nothing;

-- ── PRODUCTOS — GASEOSAS ─────────────────────────────────────

insert into public.products (
  id, sku, slug, name, short_description, category_id,
  price_b2c, price_b2b, unit_label, freezer_required, is_active,
  costo, precio_dist, precio_gastro, precio_min,
  pkg_unitario, pkg_bulto, mult_bolsas
) values
  ('b0000000-0000-0000-0000-000000000001', 'GAS-COCA-225', 'coca-cola-225l',
   'Coca-Cola 2.25L', 'Botella familiar',
   'c1000000-0000-0000-0000-000000000006', 1800, 1400, 'botella', false, true,
   900, 1200, 1350, 1500, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000002', 'GAS-COCA-150', 'coca-cola-150l',
   'Coca-Cola 1.5L', 'Botella mediana',
   'c1000000-0000-0000-0000-000000000006', 1400, 1100, 'botella', false, true,
   700, 950, 1050, 1150, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000003', 'GAS-PEPSI-225', 'pepsi-225l',
   'Pepsi 2.25L', 'Botella familiar',
   'c1000000-0000-0000-0000-000000000006', 1700, 1300, 'botella', false, true,
   850, 1150, 1280, 1400, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000004', 'GAS-7UP-225', '7up-225l',
   '7UP 2.25L', 'Botella familiar',
   'c1000000-0000-0000-0000-000000000006', 1700, 1300, 'botella', false, true,
   840, 1140, 1270, 1390, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000005', 'GAS-FANTA-225', 'fanta-naranja-225l',
   'Fanta Naranja 2.25L', 'Botella familiar sabor naranja',
   'c1000000-0000-0000-0000-000000000006', 1700, 1300, 'botella', false, true,
   840, 1140, 1270, 1390, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000006', 'GAS-SPRI-225', 'sprite-225l',
   'Sprite 2.25L', 'Botella familiar sabor limón',
   'c1000000-0000-0000-0000-000000000006', 1700, 1300, 'botella', false, true,
   840, 1140, 1270, 1390, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000007', 'GAS-MANZ-225', 'manzana-225l',
   'Manzana Stani 2.25L', 'Botella familiar sabor manzana',
   'c1000000-0000-0000-0000-000000000006', 1600, 1200, 'botella', false, true,
   780, 1050, 1180, 1300, 6, 4, false),

  ('b0000000-0000-0000-0000-000000000008', 'GAS-AGUA-500', 'agua-mineral-500ml',
   'Agua mineral 500ml', 'Botella personal sin gas',
   'c1000000-0000-0000-0000-000000000006', 600, 450, 'botella', false, true,
   250, 380, 420, 460, 24, 1, false),

  ('b0000000-0000-0000-0000-000000000009', 'GAS-AGUA-150', 'agua-mineral-150l',
   'Agua mineral 1.5L', 'Botella mediana sin gas',
   'c1000000-0000-0000-0000-000000000006', 900, 700, 'botella', false, true,
   420, 580, 650, 720, 6, 4, false)
on conflict (id) do nothing;

-- ── MOVIMIENTOS (usa las sucursales existentes por nombre) ───

do $$
declare
  s1 uuid := (select id from public.sucursales where nombre = 'Parque de las Fiestas' limit 1);
  s2 uuid := (select id from public.sucursales where nombre = 'UNAM' limit 1);
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  m3 uuid := gen_random_uuid();
  m4 uuid := gen_random_uuid();
  m5 uuid := gen_random_uuid();
  m6 uuid := gen_random_uuid();
begin
  if s1 is null or s2 is null then
    raise notice 'Sucursales no encontradas. Verificá los nombres exactos en la tabla.';
    return;
  end if;

  insert into public.movimientos (id, sucursal_id, fecha, tipo, notas) values
    (m1, s1, current_date,      'entrega',    null),
    (m2, s2, current_date - 1,  'entrega',    'Pedido completo, abonó en efectivo'),
    (m3, s1, current_date - 3,  'entrega',    null),
    (m4, s2, current_date - 5,  'entrega',    null),
    (m5, s1, current_date - 8,  'devolucion', '3 botellas golpeadas'),
    (m6, s2, current_date - 12, 'entrega',    null);

  insert into public.movimiento_items (movimiento_id, product_id, cantidad, precio_unitario, subtotal) values
    -- m1: Parque de las Fiestas hoy
    (m1, 'a0000000-0000-0000-0000-000000000001', 5,  3000, 15000),
    (m1, 'b0000000-0000-0000-0000-000000000001', 12, 1200, 14400),
    (m1, 'b0000000-0000-0000-0000-000000000003', 6,  1150,  6900),
    (m1, 'a0000000-0000-0000-0000-000000000008', 3,  1500,  4500),
    -- m2: UNAM ayer
    (m2, 'a0000000-0000-0000-0000-000000000002', 4,  2800, 11200),
    (m2, 'a0000000-0000-0000-0000-000000000004', 6,  2000, 12000),
    (m2, 'b0000000-0000-0000-0000-000000000001', 18, 1200, 21600),
    (m2, 'b0000000-0000-0000-0000-000000000002', 12,  950, 11400),
    (m2, 'b0000000-0000-0000-0000-000000000008', 24,  380,  9120),
    -- m3: Parque hace 3 días
    (m3, 'a0000000-0000-0000-0000-000000000006', 4,  1750,  7000),
    (m3, 'a0000000-0000-0000-0000-000000000010', 3,  3400, 10200),
    (m3, 'b0000000-0000-0000-0000-000000000004', 6,  1140,  6840),
    -- m4: UNAM hace 5 días
    (m4, 'a0000000-0000-0000-0000-000000000001', 8,  3000, 24000),
    (m4, 'a0000000-0000-0000-0000-000000000003', 4,  2900, 11600),
    (m4, 'b0000000-0000-0000-0000-000000000001', 12, 1200, 14400),
    (m4, 'b0000000-0000-0000-0000-000000000005', 6,  1140,  6840),
    -- m5: devolución Parque
    (m5, 'b0000000-0000-0000-0000-000000000001', 3,  1200,  3600),
    -- m6: UNAM hace 12 días
    (m6, 'a0000000-0000-0000-0000-000000000005', 5,  1800,  9000),
    (m6, 'a0000000-0000-0000-0000-000000000007', 4,  1600,  6400),
    (m6, 'b0000000-0000-0000-0000-000000000009', 8,   580,  4640);
end $$;
