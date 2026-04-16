CREATE TABLE IF NOT EXISTS public.employee_registry (
  oseba_id INTEGER PRIMARY KEY,
  ime VARCHAR,
  prezime VARCHAR,
  datum_pocetka DATE NULL,
  datum_kraja DATE NULL,
  grupa VARCHAR(10),
  mode VARCHAR(10),
  osobni_odbitak INTEGER,
  porezna_stopa DECIMAL(5,2),
  erp_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT chk_mode CHECK (mode IN ('FULL', 'SLIM')),
  CONSTRAINT chk_grupa CHECK (grupa IN ('ADM', 'INOX', 'MXD'))
);

CREATE INDEX IF NOT EXISTS idx_employee_registry_period
  ON public.employee_registry (datum_pocetka, datum_kraja);

CREATE INDEX IF NOT EXISTS idx_employee_registry_grupa
  ON public.employee_registry (grupa);
