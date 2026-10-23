alter table public.construtoras
  add column tipo text not null default 'construtora'
    check (tipo in ('construtora', 'incorporadora', 'investidor', 'outro'));

alter table public.empreendimentos
  add column subtipos text[] not null default '{}',
  add column finalidades text[] not null default '{}',
  add column endereco_extras jsonb not null default '{}'::jsonb,
  add column composicao jsonb not null default '{}'::jsonb,
  add column valores jsonb not null default '{}'::jsonb,
  add column condicoes_pagamento jsonb not null default '{}'::jsonb,
  add column caracteristicas_predio text[] not null default '{}',
  add column acabamentos text[] not null default '{}',
  add column documentacao jsonb not null default '{}'::jsonb,
  add column utilidades jsonb not null default '{}'::jsonb,
  add column temporada jsonb not null default '{}'::jsonb,
  add column ocupacao text,
  add column registro_incorporacao text,
  add column ponto_referencia text;

alter table public.unidades
  add column subtipo text,
  add column finalidade text,
  add column condicao text,
  add column banheiros integer check (banheiros is null or banheiros >= 0),
  add column lavabos integer check (lavabos is null or lavabos >= 0),
  add column salas integer check (salas is null or salas >= 0),
  add column area_total numeric(12, 2) check (area_total is null or area_total >= 0),
  add column preco_venda numeric(14, 2) check (preco_venda is null or preco_venda >= 0),
  add column preco_locacao numeric(14, 2) check (preco_locacao is null or preco_locacao >= 0),
  add column valor_iptu numeric(14, 2) check (valor_iptu is null or valor_iptu >= 0),
  add column valor_condominio numeric(14, 2) check (valor_condominio is null or valor_condominio >= 0),
  add column caracteristicas text[] not null default '{}',
  add column acabamentos text[] not null default '{}',
  add column documentacao jsonb not null default '{}'::jsonb,
  add column ocupacao text,
  add column temporada jsonb not null default '{}'::jsonb;

create table public.proprietarios (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id),
  origem_arquivo_id text not null references public.arquivos_drive(drive_file_id),
  unidade_identificacao text not null,
  tipo_pessoa text check (tipo_pessoa in ('fisica', 'juridica')),
  nome text,
  telefone_residencial text,
  telefone_celular text,
  telefone_comercial text,
  email text,
  identificador_externo text,
  local_chaves text,
  origem text,
  motivo_venda text,
  regiao text,
  dados_extras jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (origem_arquivo_id, unidade_identificacao)
);

alter table public.unidades
  add column proprietario_id uuid references public.proprietarios(id);

create index unidades_proprietario_id_idx on public.unidades (proprietario_id);
create index proprietarios_empreendimento_id_idx on public.proprietarios (empreendimento_id);
create index proprietarios_deleted_at_idx on public.proprietarios (deleted_at);
alter table public.proprietarios enable row level security;
create trigger proprietarios_set_updated_at
  before update on public.proprietarios
  for each row execute function public.set_updated_at();
grant all on public.proprietarios to service_role;