-- Debounced public search with a bounded result page and trigram name index.
create extension if not exists pg_trgm with schema extensions;
create index menu_name_trgm on public.menu_items using gin(name extensions.gin_trgm_ops);
create function public.search_menu(p_query text default '',p_category uuid default null,p_location uuid default null,p_max_price integer default null,p_offset integer default 0)
returns setof public.menu_items language sql stable security invoker set search_path='' as $$
 select m.* from public.menu_items m join public.stalls s on s.id=m.stall_id join public.locations l on l.id=s.location_id join public.categories c on c.id=m.category_id
 where not m.is_archived and s.approval_status='approved' and l.is_active
 and (p_category is null or m.category_id=p_category) and (p_location is null or s.location_id=p_location)
 and (p_max_price is null or m.price_centavos<=p_max_price)
 and (p_query='' or concat_ws(' ',m.name,s.name,l.name,c.name) ilike '%'||left(p_query,100)||'%')
 order by m.is_available desc,m.name,m.id limit 50 offset greatest(0,least(p_offset,10000))
$$;
revoke all on function public.search_menu(text,uuid,uuid,integer,integer) from public;
grant execute on function public.search_menu(text,uuid,uuid,integer,integer) to anon,authenticated;
