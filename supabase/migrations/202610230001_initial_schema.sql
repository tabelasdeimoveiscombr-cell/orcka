create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.construtoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  slug text not null unique,
  drive_folder_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  construtora_id uuid not null references public.construtoras(id),
  nome text not null,
  slug text not null,
  drive_folder_id text not null unique,
  cidade text,
  bairro text,
  endereco text,
  cep text,
  tipo text check (tipo in ('apartamento', 'casa_condominio', 'comercial', 'outro')),
  status_obra text,
  previsao_entrega date,
  descricao text,
  dados_extras jsonb not null default '{}'::jsonb,
  precisa_revisao boolean not null default false,
  motivo_revisao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (construtora_id, slug)
);

create table public.arquivos_drive (
  drive_file_id text primary key,
  nome text not null,
  mime_type text not null,
  parent_id text,
  caminho text not null,
  md5 text,
  modified_time timestamptz,
  version text,
  tamanho bigint check (tamanho is null or tamanho >= 0),
  empreendimento_id uuid references public.empreendimentos(id),
  status text not null default 'pendente'
    check (status in ('pendente', 'processado', 'erro', 'removido')),
  tentativas integer not null default 0 check (tentativas >= 0),
  ultimo_erro text,
  visto_em timestamptz not null default now(),
  processado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.unidades (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id),
  identificacao text not null,
  dormitorios integer check (dormitorios is null or dormitorios >= 0),
  suites integer check (suites is null or suites >= 0),
  vagas integer check (vagas is null or vagas >= 0),
  area_privativa numeric(12, 2) check (area_privativa is null or area_privativa >= 0),
  preco numeric(14, 2) check (preco is null or preco >= 0),
  condicoes_pagamento jsonb not null default '{}'::jsonb,
  disponivel boolean,
  origem_arquivo_id text references public.arquivos_drive(drive_file_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (empreendimento_id, identificacao)
);

create table public.historico_precos (
  id uuid primary key default gen_random_uuid(),
  unidade_id uuid not null references public.unidades(id),
  preco_anterior numeric(14, 2),
  preco_novo numeric(14, 2) not null,
  alterado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (preco_anterior is null or preco_anterior >= 0),
  check (preco_novo >= 0)
);

create table public.midias (
  id uuid primary key default gen_random_uuid(),
  empreendimento_id uuid not null references public.empreendimentos(id),
  tipo text not null check (tipo in ('foto', 'pdf')),
  r2_key text not null,
  r2_thumb_key text,
  largura integer check (largura is null or largura > 0),
  altura integer check (altura is null or altura > 0),
  ordem integer not null default 0,
  origem_arquivo_id text references public.arquivos_drive(drive_file_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (origem_arquivo_id)
);

create table public.execucoes_sync (
  id uuid primary key default gen_random_uuid(),
  iniciado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  modo text not null check (modo in ('completo', 'dry_run')),
  status text not null default 'executando'
    check (status in ('executando', 'concluido', 'alerta', 'erro')),
  contagens jsonb not null default '{"criados":0,"atualizados":0,"removidos":0,"ignorados":0,"erros":0}'::jsonb,
  log_resumo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index empreendimentos_construtora_id_idx on public.empreendimentos (construtora_id);
create index empreendimentos_public_search_idx on public.empreendimentos (cidade, bairro) where deleted_at is null;
create index arquivos_drive_parent_id_idx on public.arquivos_drive (parent_id);
create index arquivos_drive_empreendimento_id_idx on public.arquivos_drive (empreendimento_id);
create index arquivos_drive_status_visto_idx on public.arquivos_drive (status, visto_em);
create index unidades_empreendimento_id_idx on public.unidades (empreendimento_id);
create index unidades_origem_arquivo_id_idx on public.unidades (origem_arquivo_id);
create index historico_precos_unidade_alterado_idx on public.historico_precos (unidade_id, alterado_em desc);
create index midias_empreendimento_ordem_idx on public.midias (empreendimento_id, ordem) where deleted_at is null;
create index execucoes_sync_iniciado_em_idx on public.execucoes_sync (iniciado_em desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'construtoras', 'empreendimentos', 'arquivos_drive', 'unidades',
    'historico_precos', 'midias', 'execucoes_sync'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

create policy construtoras_public_read on public.construtoras
  for select to anon, authenticated using (deleted_at is null);
create policy empreendimentos_public_read on public.empreendimentos
  for select to anon, authenticated using (deleted_at is null);
create policy unidades_public_read on public.unidades
  for select to anon, authenticated using (deleted_at is null);
create policy midias_public_read on public.midias
  for select to anon, authenticated using (deleted_at is null);

grant select on public.construtoras, public.empreendimentos, public.unidades, public.midias
  to anon, authenticated;
grant all on public.construtoras, public.empreendimentos, public.arquivos_drive,
  public.unidades, public.historico_precos, public.midias, public.execucoes_sync
  to service_role;