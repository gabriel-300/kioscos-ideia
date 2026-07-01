ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_minimo numeric(10,2) NOT NULL DEFAULT 0;
