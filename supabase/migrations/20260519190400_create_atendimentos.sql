CREATE TABLE IF NOT EXISTS atendimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id uuid NOT NULL REFERENCES profiles(id),
  data date NOT NULL,
  id_cliente text,
  nome_cliente text NOT NULL,
  telefone text,
  email text,
  produto text,
  ocorrencia text,
  visita boolean DEFAULT false,
  venda boolean DEFAULT false,
  temperatura text CHECK (temperatura IN ('Frio', 'Morno', 'Quente')),
  status text CHECK (status IN (
    'Prospect',
    'Proposta em Análise',
    'Proposta Aprovada',
    'Contrato Gerado',
    'Contrato Assinado',
    'Cancelada'
  )),
  valor numeric(15,2),
  setor text CHECK (setor IN ('Online', 'Salão')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE atendimentos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'atendimentos' AND policyname = 'broker_own') THEN
    CREATE POLICY "broker_own" ON atendimentos USING (broker_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'atendimentos' AND policyname = 'admin_all') THEN
    CREATE POLICY "admin_all" ON atendimentos
      USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
  END IF;
END $$;
